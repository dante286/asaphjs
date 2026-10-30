import { and, eq, gte, isNotNull, isNull, type SQL } from "drizzle-orm";
import { db } from "@/db/client";
import { registrationInvites } from "@/db/schema";
import { INVITE_TTL_DAYS } from "./members";

/** How an address is stored here, so it compares equal to `user.email`. */
export function normalizeInviteEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * An invite that can still be used: it has a token (revoking clears it), it
 * hasn't been used, and it was sent within `INVITE_TTL_DAYS`. The one
 * definition, so the gate, the `/join` page, and the list and cap on the
 * Invite someone card can't disagree about which invites count.
 *
 * The cutoff is computed here from `now` rather than with SQL `now()`, so specs
 * can move the clock. It agrees with `inviteExpired()`: expired is strictly
 * older than the TTL, so an invite exactly at it is still pending.
 */
export function pendingInvite(now = Date.now()): SQL {
  const cutoff = new Date(now - INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
  return and(
    isNotNull(registrationInvites.token),
    isNull(registrationInvites.usedAt),
    gte(registrationInvites.sentAt, cutoff),
  )!;
}

/**
 * The pending invite `token` names, if any. Expired, used and revoked tokens
 * read the same as one never issued: nothing about them is worth telling the
 * person holding the link apart.
 */
export async function findInviteByToken(token: string, now = Date.now()) {
  return db.query.registrationInvites.findFirst({
    where: and(eq(registrationInvites.token, token), pendingInvite(now)),
  });
}

/**
 * Called once the sign-up that `token` let through has committed. Conditional
 * on the email as well as the token, so a token sent with some other address
 * can't use up an invite it didn't redeem, and on `used_at` so a replay can't
 * move the timestamp.
 */
export async function markInviteUsed(token: string, email: string, now = new Date()): Promise<void> {
  await db
    .update(registrationInvites)
    .set({ usedAt: now })
    .where(
      and(
        eq(registrationInvites.token, token),
        eq(registrationInvites.email, normalizeInviteEmail(email)),
        isNull(registrationInvites.usedAt),
      ),
    );
}
