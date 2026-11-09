import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Fixed-window counters for the auth limiter in `src/lib/auth/rate-limit.ts`.
 * One row per key (`sign-in:email:<address>`, `sign-in:ip:<ip>`, …), reset in
 * place when its window has passed, so the table stays as small as the number
 * of distinct keys seen recently. Expired rows are swept opportunistically.
 *
 * In Postgres rather than memory so the counts survive a restart: otherwise
 * restarting the container would hand a password guesser a fresh allowance.
 */
export const authRateLimits = pgTable("auth_rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  windowStart: timestamp("window_start", { withTimezone: true }).defaultNow().notNull(),
});
