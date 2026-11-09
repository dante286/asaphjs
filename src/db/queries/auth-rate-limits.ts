import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { authRateLimits } from "@/db/schema";

/** How long an expired row may linger before a sweep removes it. */
const SWEEP_AFTER_SECONDS = 24 * 60 * 60;

/** Fraction of hits that also sweep expired rows: cheap, and no timer to own. */
const SWEEP_PROBABILITY = 0.01;

/**
 * Counts one attempt against `key` and returns the count in the current window,
 * this attempt included. One statement, so concurrent attempts can't all read
 * the same count and all slip under the limit: Postgres serializes the upserts
 * on the row, and each sees the one before it.
 *
 * A window that has passed restarts at 1 instead of carrying on from the old
 * count. The comparison uses the database clock throughout, like every other
 * timestamp the app writes.
 */
export async function hitRateLimit(key: string, windowSeconds: number): Promise<number> {
  const expired = sql`${authRateLimits.windowStart} <= now() - make_interval(secs => ${windowSeconds})`;

  const [row] = await db
    .insert(authRateLimits)
    .values({ key, count: 1 })
    .onConflictDoUpdate({
      target: authRateLimits.key,
      set: {
        count: sql`case when ${expired} then 1 else ${authRateLimits.count} + 1 end`,
        windowStart: sql`case when ${expired} then now() else ${authRateLimits.windowStart} end`,
      },
    })
    .returning({ count: authRateLimits.count });

  if (Math.random() < SWEEP_PROBABILITY) await sweepExpiredRateLimits();

  return row.count;
}

/** Forgets `key` entirely. A successful sign-in clears its address's failed attempts. */
export async function clearRateLimit(key: string): Promise<void> {
  await db.delete(authRateLimits).where(eq(authRateLimits.key, key));
}

/** Removes rows whose window ended long enough ago that no limit could still use them. */
export async function sweepExpiredRateLimits(): Promise<void> {
  await db
    .delete(authRateLimits)
    .where(sql`${authRateLimits.windowStart} < now() - make_interval(secs => ${SWEEP_AFTER_SECONDS})`);
}
