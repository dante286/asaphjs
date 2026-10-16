"use server";

import { nanoid } from "nanoid";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { inviteEmail, sendEmail } from "@/lib/email";
import { requestOrigin } from "@/lib/request-origin";
import { resolveRole } from "@/db/queries/members";
import {
  INVITE_TTL_DAYS,
  acceptInvite,
  inviteMember,
  removeMember,
  updateMemberRole,
} from "@/db/queries/members";
import { updateCollectionSettings, getCollectionById } from "@/db/queries/collections";

async function requireOwner(collectionId: string, userId: string) {
  const role = await resolveRole(collectionId, userId);
  if (role !== "owner") throw new Error("Only the owner can manage sharing.");
}

/**
 * What became of the invite email. The invite itself exists in every case but
 * `already_member` — mail is how the link travels, not what makes it valid.
 */
export type InviteEmailOutcome = "sent" | "not_configured" | "failed";

export type InviteResult =
  | { ok: false; reason: "already_member" }
  | {
      ok: true;
      invitedEmail: string;
      role: "viewer" | "editor";
      /** Absolute, for the card's Copy link: the fallback when mail didn't go. */
      inviteUrl: string;
      email: InviteEmailOutcome;
    };

export async function inviteMemberAction(
  collectionId: string,
  email: string,
  role: "viewer" | "editor",
): Promise<InviteResult> {
  const session = await requireSession();
  await requireOwner(collectionId, session.user.id);

  const member = await inviteMember({
    collectionId,
    invitedEmail: email.toLowerCase().trim(),
    role,
    invitedBy: session.user.id,
  });
  // Already accepted: the query left them as they were, and there's nothing to
  // send — their access never lapsed.
  if (member.acceptedAt) return { ok: false, reason: "already_member" };

  // Absolute, and from the host this request arrived on — the same reason as
  // the share link: the image carries no origin of its own.
  const inviteUrl = `${await requestOrigin()}/invite/${member.inviteToken}`;
  const collection = await getCollectionById(collectionId);

  let outcome: InviteEmailOutcome;
  try {
    outcome = await sendEmail(
      inviteEmail({
        to: member.invitedEmail,
        inviterName: session.user.name || session.user.email,
        collectionName: collection?.name ?? "a collection",
        role,
        url: inviteUrl,
        expiresInDays: INVITE_TTL_DAYS,
      }),
    );
  } catch (err) {
    // The row stays. It's a working invite whether or not mail went out, and
    // rolling it back over an SMTP outage would make the owner start again for
    // no reason — the card offers the link to copy instead. The operator still
    // needs the cause, which the owner can't see.
    console.error(`[email] invite to ${member.invitedEmail} wasn't sent:`, err);
    outcome = "failed";
  }

  return { ok: true, invitedEmail: member.invitedEmail, role, inviteUrl, email: outcome };
}

export async function updateMemberRoleAction(
  collectionId: string,
  invitedEmail: string,
  role: "viewer" | "editor",
) {
  const session = await requireSession();
  await requireOwner(collectionId, session.user.id);
  await updateMemberRole(collectionId, invitedEmail, role);
}

export async function removeMemberAction(collectionId: string, invitedEmail: string) {
  const session = await requireSession();
  await requireOwner(collectionId, session.user.id);
  await removeMember(collectionId, invitedEmail);
}

export async function togglePublicLinkAction(collectionId: string, enabled: boolean) {
  const session = await requireSession();
  await requireOwner(collectionId, session.user.id);

  const collection = await getCollectionById(collectionId);
  const shareToken = enabled ? collection?.shareToken ?? nanoid(24) : collection?.shareToken ?? null;

  await updateCollectionSettings(collectionId, { shareEnabled: enabled, shareToken });
  // Enabling mints the token server-side, and the page builds the URL from it —
  // without a re-render the owner sees a switched-on link and no address until
  // they reload.
  refresh();
}

export async function rotateShareTokenAction(collectionId: string) {
  const session = await requireSession();
  await requireOwner(collectionId, session.user.id);
  await updateCollectionSettings(collectionId, { shareToken: nanoid(24) });
  // Same reason: a rotated token is a new URL the page has to be told about.
  refresh();
}

export async function acceptInviteAction(token: string) {
  const session = await requireSession();
  const result = await acceptInvite(token, session.user.id, session.user.email);
  if (!result.ok) {
    if (result.reason === "email_mismatch") {
      throw new Error("This invite was sent to a different email address.");
    }
    if (result.reason === "expired") throw new Error("This invite has expired.");
    throw new Error("Invite not found.");
  }
  const collection = await getCollectionById(result.collectionId);
  redirect(`/collections/${collection?.slug ?? ""}`);
}
