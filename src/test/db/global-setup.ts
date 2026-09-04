import { config } from "dotenv";
import { Client, Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { TEMPLATE_DB, TEST_DB_PREFIX, adminUrl, serverDescription, urlFor } from "./database";

/**
 * Loaded the same way drizzle.config.ts and the seed scripts do, and for the
 * same reason: this is the one tier that needs a `DATABASE_URL`, and a
 * developer already has theirs here. `config()` does not overwrite a variable
 * that is already set, so CI's job environment wins over any file and a missing
 * `.env.local` is a silent no-op rather than an error.
 */
config({ path: ".env.local" });

/**
 * Runs once per `vitest run`, before any worker starts: build one migrated,
 * template-seeded database that every worker then clones.
 *
 * Migrations run exactly once here rather than once per worker or once per
 * spec file. On Postgres `CREATE DATABASE ... TEMPLATE ...` is a filesystem
 * copy of the source directory, so a worker gets its own database — its own
 * copy of every table, index and generated column — in tens of milliseconds.
 *
 * That is what makes the isolation problem go away rather than be worked
 * around. `src/db/client.ts` exports one module-level pool and every query
 * module imports it directly, so there is no seam to inject a transaction
 * through; the usual transaction-per-test-with-rollback would mean mocking the
 * singleton wholesale, and it would make the `withFreshSlug` concurrency test
 * impossible by construction — that behaviour only exists across genuinely
 * concurrent connections, which is one of the main reasons this tier exists.
 * A database per worker means the shared pool is simply pointed somewhere
 * private.
 *
 * The migrator is called programmatically rather than by shelling out to
 * `drizzle-kit`, whose config insists on reading a `.env.local` that CI does
 * not have.
 */
export async function setup(): Promise<void> {
  const admin = new Client({ connectionString: adminUrl() });

  try {
    await admin.connect();
  } catch (err) {
    throw new Error(
      `The integration tier needs a Postgres server at ${serverDescription()}. ` +
        `Start one with \`docker compose up -d db\`, or set DATABASE_URL to a server you have. ` +
        `Nothing outside databases named ${TEST_DB_PREFIX}* is touched.\n${String(err)}`,
    );
  }

  try {
    // Anything left by an earlier run goes first — a worker database that
    // survived a crash would otherwise be reused with the schema it had then.
    await dropTestDatabases(admin);
    await admin.query(`create database "${TEMPLATE_DB}"`);
  } finally {
    await admin.end();
  }

  const templateUrl = urlFor(TEMPLATE_DB);
  const pool = new Pool({ connectionString: templateUrl });
  try {
    // The six migration files, applied to an empty database. Nothing else
    // proves meta/_journal.json is consistent with them, which is why CI runs
    // this tier at all rather than only the specs.
    await migrate(drizzle(pool), { migrationsFolder: "drizzle/migrations" });
  } finally {
    await pool.end();
  }

  await seedTemplatesInto(templateUrl);
}

/**
 * The 15 system templates, seeded into the template database so every worker's
 * clone already has them: collection creation copies a template's field defs
 * onto the new row, so the flows this tier tests need something to clone from.
 * They are also the one table the between-test truncate leaves alone.
 *
 * The real seeder runs, rather than a fixture that inserts its own idea of a
 * template — a divergence there would make every collection-creation spec test
 * data nobody ships.
 */
async function seedTemplatesInto(templateUrl: string): Promise<void> {
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = templateUrl;
  try {
    // Dynamic, because the seeder imports db/client.ts, which captures
    // DATABASE_URL at module evaluation — a static import would hoist above
    // the assignment above. The same trick scripts/seed/run.ts uses.
    const { seedTemplates } = await import("../../../scripts/seed/templates");
    await seedTemplates();

    // Otherwise this process holds an idle connection to the template, and
    // `CREATE DATABASE ... TEMPLATE ...` refuses a source database anyone else
    // is connected to.
    const { pool } = await import("@/db/client");
    await pool.end();
  } finally {
    // Restored so a worker can't inherit a pointer to the template it is
    // supposed to be cloning. Each worker sets its own in the setup file, but
    // leaving this one loaded would make a failure there write to the template
    // instead of erroring.
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
}

async function dropTestDatabases(admin: Client): Promise<void> {
  const { rows } = await admin.query<{ datname: string }>(
    `select datname from pg_database where datname like $1`,
    [`${TEST_DB_PREFIX}%`],
  );
  for (const { datname } of rows) {
    // WITH (FORCE) terminates whatever is still connected — a worker from a
    // run that was interrupted, or a psql session left open while debugging.
    await admin.query(`drop database if exists "${datname}" with (force)`);
  }
}

/**
 * Leaves the server as it was found. `KEEP_TEST_DATABASES=1` skips this, which
 * is what to reach for when a spec fails and the rows it left behind are the
 * evidence — the next run drops them anyway.
 */
export async function teardown(): Promise<void> {
  if (process.env.KEEP_TEST_DATABASES) {
    console.log(`Kept ${TEST_DB_PREFIX}* databases (KEEP_TEST_DATABASES).`);
    return;
  }

  const admin = new Client({ connectionString: adminUrl() });
  await admin.connect();
  try {
    await dropTestDatabases(admin);
  } finally {
    await admin.end();
  }
}
