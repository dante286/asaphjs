import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeEach } from "vitest";
import { TEMPLATE_DB, urlFor, workerDbName } from "./database";

/**
 * Runs before the spec module in every file of this tier, and everything at the
 * top level here has to happen before that import: `src/db/client.ts` captures
 * `DATABASE_URL` when it is first evaluated, and every query module imports
 * that singleton. Point it after the fact and the pool is already built against
 * whatever the developer had in their shell — their real database.
 *
 * Vitest gives each test file its own module registry, so this runs once per
 * file and the pool it points is per file too. `afterAll` closes it.
 */
const DB_NAME = workerDbName(process.env.VITEST_POOL_ID);

process.env.DATABASE_URL = urlFor(DB_NAME);

/**
 * Better Auth signs sessions with this and the fixtures create real users
 * through `auth.api.signUpEmail`, so it has to be set — but never to anything
 * real. `??=` so a developer with one in `.env.local` isn't overridden into a
 * different one mid-run.
 */
process.env.BETTER_AUTH_SECRET ??= "asaph-integration-tier-not-a-real-secret";

/**
 * `auth.ts` reads this at module evaluation to decide `disableSignUp`, and a
 * developer running an instance with registration closed would otherwise have
 * every user fixture fail with EMAIL_PASSWORD_SIGN_UP_DISABLED.
 */
process.env.ALLOW_SIGNUPS = "true";

/**
 * Blanked rather than left alone, matching what the CI job sets: this tier
 * makes no provider calls, and pinning `isProviderConfigured()` to false means
 * a developer with real keys in `.env.local` and CI with none are running the
 * same suite. The providers tier is where credentials get faked deliberately.
 */
process.env.IGDB_CLIENT_ID = "";
process.env.IGDB_CLIENT_SECRET = "";
process.env.TMDB_API_KEY = "";

/**
 * Cover deletes are part of what the query layer does — `deleteItem`,
 * `deleteCollection`, `rollbackImportBatch` and `deleteUploadsForOwner` all
 * unlink files — so these specs write real ones. Per worker, so two workers
 * unlinking a fixture cover named the same thing can't take each other's, and
 * under the OS temp directory rather than the repo's own `uploads/`, which is
 * a developer's actual data.
 */
export const UPLOADS_DIR = path.join(tmpdir(), "asaph-test-uploads", DB_NAME);
process.env.UPLOADS_DIR = UPLOADS_DIR;

/**
 * The clone. Cheap enough to do per worker rather than per file — the check is
 * one row from pg_database — and per worker is the level that matters, because
 * a database is what makes the shared pool private.
 *
 * Serialised on an advisory lock: `CREATE DATABASE ... TEMPLATE ...` takes a
 * lock on the source database, and several workers starting at once would
 * otherwise race on the same template.
 */
const CLONE_LOCK = 0xa5a9_4c07; // arbitrary, just has to be this tier's own

async function ensureWorkerDatabase(): Promise<void> {
  const admin = new Client({ connectionString: urlFor("postgres") });
  await admin.connect();
  try {
    await admin.query("select pg_advisory_lock($1)", [CLONE_LOCK]);
    const { rowCount } = await admin.query("select 1 from pg_database where datname = $1", [DB_NAME]);
    if (!rowCount) {
      await admin.query(`create database "${DB_NAME}" template "${TEMPLATE_DB}"`);
    }
  } finally {
    // Released by disconnecting either way, but explicitly, so a slow drop
    // can't hold the next worker up longer than the create itself.
    await admin.query("select pg_advisory_unlock($1)", [CLONE_LOCK]).catch(() => {});
    await admin.end();
  }
}

await ensureWorkerDatabase();

/**
 * The 15 system templates are seeded into the template database, so a clone
 * arrives with them and collection-creation flows have something real to copy
 * field defs from. Keeping them across tests is the reason this is two
 * statements rather than one.
 *
 * `TRUNCATE ... CASCADE` also truncates every table holding a foreign key into
 * what it truncated, and `templates.owner_id` references `user` — so
 * truncating `user` takes the seeded rows with it, which is exactly the bug
 * this shape fixes. So: truncate everything except those two, then `DELETE FROM
 * "user"`, which cascades row by row through `on delete cascade` and therefore
 * only removes templates a test's own user owned. System templates have a null
 * owner and stay.
 *
 * The list is read once per file and cached — it only changes when a migration
 * adds a table. Drizzle's own migrations table lives in the `drizzle` schema,
 * so filtering to `public` leaves it alone without naming it.
 */
const KEPT_TABLES = ["user", "templates"];

let tablesToTruncate: string[] | null = null;

async function truncateAll(): Promise<void> {
  const { pool } = await import("@/db/client");

  if (!tablesToTruncate) {
    const { rows } = await pool.query<{ table_name: string }>(
      `select table_name from information_schema.tables
       where table_schema = 'public' and table_type = 'BASE TABLE'
         and table_name <> all($1::text[])`,
      [KEPT_TABLES],
    );
    tablesToTruncate = rows.map((r) => r.table_name);
  }

  // One statement rather than one per table: CASCADE aside, TRUNCATE refuses a
  // table referenced by a foreign key unless the referencing table is named in
  // the same command.
  const list = tablesToTruncate.map((t) => `"${t}"`).join(", ");
  await pool.query(`truncate table ${list} restart identity cascade`);
  await pool.query(`delete from "user"`);
}

/**
 * Before rather than after, so a spec that fails midway leaves its rows for
 * inspection and the next test still starts from nothing.
 */
beforeEach(async () => {
  await truncateAll();
  await rm(UPLOADS_DIR, { recursive: true, force: true });
  await mkdir(UPLOADS_DIR, { recursive: true });
});

afterAll(async () => {
  // The pool the spec's queries ran on: same module registry, same instance.
  // Without this a worker that ran six spec files would hold six idle pools
  // until the process exits.
  const { pool } = await import("@/db/client");
  await pool.end();
  await rm(UPLOADS_DIR, { recursive: true, force: true });
});
