"use server";

import { z } from "zod";
import { INVITE_TTL_DAYS } from "@/db/queries/members";
import {
  inviteToRegister,
  markInviteNotSent,
  normalizeInviteEmail,
  revokeRegistrationInvite,
} from "@/db/queries/registration-invites";
import { trustedLinkOrigin } from "@/lib/auth/link-origin";
import { registrationInvitesAvailable } from "@/lib/auth/registration-invites";
import { requireSession } from "@/lib/auth/session";
import { registrationInviteEmail, sendEmail } from "@/lib/email";

/** One row of the Invite someone card's list. */
export type PendingRegistrationInvite = {
  email: string;
  /** ISO. When the current link was sent, which the card counts the cooldown from. */
  sentAt: string;
  /** The email carrying the current link didn't go out. */
  notSent: boolean;
};

export type InviteToRegisterActionResult =
  | { ok: true; invite: PendingRegistrationInvite }
  | { ok: false; reason: "unavailable" | "invalid_email" | "has_account" | "already_invited" | "cap" }
  | { ok: false; reason: "cooldown"; secondsLeft: number };

/**
 * Invites an address to register on this instance, and emails it the link.
 * Also what Resend calls: re-inviting refreshes the token, and the cooldown in
 * `inviteToRegister` is what stops it being a mail cannon.
 *
 * A Server Action is a public endpoint whatever the page renders, so the
 * conditions that hide the card are checked here too.
 */
export async function inviteToRegisterAction(email: string): Promise<InviteToRegisterActionResult> {
  const session = await requireSession();
  const origin = trustedLinkOrigin();
  if (!registrationInvitesAvailable() || !origin) return { ok: false, reason: "unavailable" };

  const address = normalizeInviteEmail(email);
  if (!z.email().safeParse(address).success) return { ok: false, reason: "invalid_email" };

  const result = await inviteToRegister({ email: address, invitedBy: session.user.id });
  if (!result.ok) return result;
  const { invite } = result;

  let sent = false;
  try {
    sent =
      (await sendEmail(
        registrationInviteEmail({
          to: invite.email,
          inviterName: session.user.name || session.user.email,
          // From BETTER_AUTH_URL, never the request: see `trustedLinkOrigin`.
          url: `${origin}/join/${invite.token}`,
          expiresInDays: INVITE_TTL_DAYS,
        }),
      )) === "sent";
  } catch (err) {
    // The row stays, shown as "Not sent" with Resend: the token never reached
    // anyone, so keeping it is safe, and the cooldown counts from this attempt.
    // The inviter can't see why; the operator needs to.
    console.error(`[email] registration invite to ${invite.email} wasn't sent:`, err);
  }
  if (!sent) await markInviteNotSent(invite.email, invite.token);

  return { ok: true, invite: { email: invite.email, sentAt: invite.sentAt.toISOString(), notSent: !sent } };
}

/**
 * Withdraws one of your pending invites. Not gated on availability: taking
 * access back is always allowed, and an inviter whose operator has since opened
 * signups or turned off mail may still want the link dead.
 */
export async function revokeRegistrationInviteAction(email: string): Promise<{ revoked: boolean }> {
  const session = await requireSession();
  return { revoked: await revokeRegistrationInvite(email, session.user.id) };
}
