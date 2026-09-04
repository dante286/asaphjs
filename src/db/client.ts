import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

/**
 * Exported so the integration tier can close it deterministically. Vitest gives
 * each test file its own module registry, so a worker that runs six spec files
 * evaluates this module six times and would otherwise leave six idle pools open
 * until the process exits. Nothing in the app closes it — a long-running server
 * wants exactly one pool for its whole life.
 *
 * Note that the connection string is captured here, at module evaluation. A
 * caller that needs to point this somewhere else has to set `DATABASE_URL`
 * before this module is first imported; the seed scripts do that with a dynamic
 * `await import()`, and the integration tier does it from a setup file.
 */
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export const db = drizzle(pool, { schema });
