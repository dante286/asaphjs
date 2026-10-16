import { and, eq, like } from "drizzle-orm";
import { db } from "@/db/client";
import { verification } from "@/db/schema";

/**
 * How long one address has to wait between reset emails. Long enough that a
 * loop can't turn the instance into a mail cannon aimed at someone's inbox (and
 * at the operator's send quota); short enough that a person who mistyped and
 * tries again isn't stuck.
 */
export const RESET_COOLDOWN_SECONDS = 60;

/** Better Auth's own prefix for these rows (`api/routes/password.mjs`). */
const PREFIX = "reset-password:";

/**
 * Whether the reset request that just minted `token` is the one that should
 * send mail. Called from `sendResetPassword`, after Better Auth has written the
 * row: an earlier row for the same user inside the cooldown means this one is
 * dropped, and its row deleted, since a link nobody was sent is just clutter.
 *
 * Here rather than in the Server Action because this callback is the one place
 * both entry points pass through. Better Auth's own limiter (3 a minute) only
 * runs for HTTP requests to `/api/auth/*`; a Server Action calls `auth.api.*`
 * directly and never meets it. A check in the action would have left the HTTP
 * route rate-limited per IP only, which an address list and a few IPs get past.
 *
 * "Earlier" is by `createdAt`, then by id, so two requests that land together
 * agree on which of them sends. Comparing each to *any* other row would have
 * had both see the other and both stay quiet — a double-clicked button that
 * sends nothing. Compared in JavaScript rather than in SQL because the column is
 * `timestamp` without a zone and both sides then go through drizzle's one
 * mapping, rather than a SQL `now()` that answers in the server's zone.
 */
export async function shouldSendReset(userId: string, token: string, now = Date.now()): Promise<boolean> {
  const rows = await db
    .select({ id: verification.id, identifier: verification.identifier, createdAt: verification.createdAt })
    .from(verification)
    .where(and(eq(verification.value, userId), like(verification.identifier, `${PREFIX}%`)));

  const mine = rows.find((row) => row.identifier === `${PREFIX}${token}`);
  // Consumed or swept already — there's no live link to send.
  if (!mine) return false;

  const cooldownStart = now - RESET_COOLDOWN_SECONDS * 1000;
  const earlier = rows.some(
    (row) =>
      row !== mine &&
      row.createdAt.getTime() >= cooldownStart &&
      (row.createdAt < mine.createdAt || (row.createdAt.getTime() === mine.createdAt.getTime() && row.id < mine.id)),
  );
  if (!earlier) return true;

  await db.delete(verification).where(eq(verification.id, mine.id));
  return false;
}
