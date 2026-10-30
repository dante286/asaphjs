import { and, count, desc, eq, gte, isNotNull, isNull, lt, ne, or, sql, type SQL } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/db/client";
import { registrationInvites, user } from "@/db/schema";
import { INVITE_TTL_DAYS } from "./members";

const INVITE_TTL_MS = INVITE_TTL_DAYS * 24 * 60 * 60 * 1000;

/**
 * How long one address waits between invite emails, matching
 * `RESET_COOLDOWN_SECONDS` and for the same reason: Better Auth's rate limiter
 * only sees HTTP requests to `/api/auth/*`, and invites are sent from a Server
 * Action, so this is the one thing stopping a loop from aiming the instance's
 * mail at someone's inbox and its send quota.
 */
export const INVITE_RESEND_COOLDOWN_SECONDS = 60;

/** Pending invites one person may have out at once. Re-inviting one of them doesn't take another. */
export const MAX_PENDING_INVITES = 5;

/** This table's class of `pg_advisory_xact_lock`, so its per-inviter lock can't meet anyone else's. */
const INVITER_LOCK = 0x5249_4e56; // arbitrary; "RINV"

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
  const cutoff = new Date(now - INVITE_TTL_MS);
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

export type InviteToRegisterResult =
  | { ok: true; invite: typeof registrationInvites.$inferSelect & { token: string } }
  | { ok: false; reason: "has_account" | "already_invited" | "cap" }
  | { ok: false; reason: "cooldown"; secondsLeft: number };

/**
 * Invites an address to register, or re-invites it: a fresh token and a fresh
 * `sent_at`, so the old link dies and the 14 days start over. That's also what
 * Resend is. Refused for an address that has an account, one with someone
 * else's pending invite, inside the resend cooldown, and past the cap.
 *
 * The ownership and cooldown rules are the upsert's `setWhere` rather than a
 * read before it, so they hold under concurrency: two quick Resends can't both
 * write, and neither can two people inviting one address. The cap needs a count
 * first, so the count and the write share a transaction under a per-inviter
 * advisory lock, and two quick submits can't make a sixth.
 *
 * `now` is injectable, as in `shouldSendReset`, so specs can move the clock.
 */
export async function inviteToRegister(params: {
  email: string;
  invitedBy: string;
  now?: number;
}): Promise<InviteToRegisterResult> {
  const email = normalizeInviteEmail(params.email);
  const me = params.invitedBy;
  const now = params.now ?? Date.now();
  const sentAt = new Date(now);
  const expiredBefore = new Date(now - INVITE_TTL_MS);
  const cooldownBefore = new Date(now - INVITE_RESEND_COOLDOWN_SECONDS * 1000);

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${INVITER_LOCK}, hashtext(${me}))`);

    const account = await tx.query.user.findFirst({ where: eq(user.email, email), columns: { id: true } });
    if (account) return { ok: false, reason: "has_account" };

    // A used invite with no account behind it is one whose account was since
    // deleted. It's spent, and left alone it would block that address forever.
    await tx
      .delete(registrationInvites)
      .where(and(eq(registrationInvites.email, email), isNotNull(registrationInvites.usedAt)));

    // Excluding this address: re-inviting one already on your list refreshes
    // it rather than taking another slot.
    const [{ pending }] = await tx
      .select({ pending: count() })
      .from(registrationInvites)
      .where(
        and(eq(registrationInvites.invitedBy, me), pendingInvite(now), ne(registrationInvites.email, email)),
      );
    if (pending >= MAX_PENDING_INVITES) return { ok: false, reason: "cap" };

    const token = nanoid(24);
    const [written] = await tx
      .insert(registrationInvites)
      .values({ email, token, invitedBy: me, sentAt })
      .onConflictDoUpdate({
        target: registrationInvites.email,
        set: { token, invitedBy: me, sentAt, sendFailedAt: null },
        setWhere: and(
          isNull(registrationInvites.usedAt),
          // Yours, or nobody's to lose: revoked, expired, or sent by someone
          // who has since deleted their account. Taking over someone else's
          // pending invite would silently free a slot on their list and break
          // the link they sent.
          or(
            eq(registrationInvites.invitedBy, me),
            isNull(registrationInvites.invitedBy),
            isNull(registrationInvites.token),
            lt(registrationInvites.sentAt, expiredBefore),
          ),
          // From the last attempt, sent or not, and kept through a revoke, so
          // revoke-then-invite is no way around it.
          lt(registrationInvites.sentAt, cooldownBefore),
        ),
      })
      .returning();
    if (written) return { ok: true, invite: { ...written, token } };

    // Nothing written: say which rule held it back.
    const existing = await tx.query.registrationInvites.findFirst({ where: eq(registrationInvites.email, email) });
    if (!existing || existing.usedAt) return { ok: false, reason: "has_account" };
    const othersPending =
      existing.invitedBy !== me &&
      existing.invitedBy !== null &&
      existing.token !== null &&
      existing.sentAt >= expiredBefore;
    if (othersPending) return { ok: false, reason: "already_invited" };
    const secondsLeft = Math.ceil(
      (existing.sentAt.getTime() + INVITE_RESEND_COOLDOWN_SECONDS * 1000 - now) / 1000,
    );
    return { ok: false, reason: "cooldown", secondsLeft: Math.max(secondsLeft, 1) };
  });
}

/**
 * Records that the email carrying `token` didn't go out. Conditional on the
 * token, so a failure reported after a newer invite was sent can't mark that
 * one.
 */
export async function markInviteNotSent(email: string, token: string, now = new Date()): Promise<void> {
  await db
    .update(registrationInvites)
    .set({ sendFailedAt: now })
    .where(and(eq(registrationInvites.email, normalizeInviteEmail(email)), eq(registrationInvites.token, token)));
}

/**
 * Withdraws one of your pending invites by clearing its token, rather than
 * deleting the row: the link stops working and the invite leaves your list and
 * the cap, but `sent_at` stays, so the cooldown still applies to inviting that
 * address again. Deleting would make revoke-then-invite a way around it.
 * Returns whether there was anything to revoke.
 */
export async function revokeRegistrationInvite(email: string, invitedBy: string): Promise<boolean> {
  const revoked = await db
    .update(registrationInvites)
    .set({ token: null })
    .where(
      and(
        eq(registrationInvites.email, normalizeInviteEmail(email)),
        eq(registrationInvites.invitedBy, invitedBy),
        isNotNull(registrationInvites.token),
        isNull(registrationInvites.usedAt),
      ),
    )
    .returning({ email: registrationInvites.email });
  return revoked.length > 0;
}

/** Your pending invites, newest first: the Invite someone card's list, and exactly the set the cap counts. */
export async function listPendingInvites(invitedBy: string, now = Date.now()) {
  return db
    .select({
      email: registrationInvites.email,
      sentAt: registrationInvites.sentAt,
      sendFailedAt: registrationInvites.sendFailedAt,
    })
    .from(registrationInvites)
    .where(and(eq(registrationInvites.invitedBy, invitedBy), pendingInvite(now)))
    .orderBy(desc(registrationInvites.sentAt));
}
