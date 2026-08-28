"use server";

import { nanoid } from "nanoid";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { resolveRole } from "@/db/queries/members";
import {
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

export async function inviteMemberAction(
  collectionId: string,
  email: string,
  role: "viewer" | "editor",
) {
  const session = await requireSession();
  await requireOwner(collectionId, session.user.id);

  const member = await inviteMember({
    collectionId,
    invitedEmail: email.toLowerCase().trim(),
    role,
    invitedBy: session.user.id,
  });

  // Stub email adapter — no real provider wired up yet.
  console.log(
    `[dev email stub] invite link for ${member.invitedEmail}: /invite/${member.inviteToken}`,
  );
  return member;
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
