/**
 * Where this tier's databases live and what they are called. Shared by the
 * global setup (which builds the template) and the per-worker setup (which
 * clones it), so neither can drift from the other's idea of a name.
 *
 * Nothing here ever touches the database named in `DATABASE_URL`. That URL is
 * read for its *server* — host, port, credentials — and every database this
 * tier creates, writes and drops is one it made itself under the
 * `asaph_test_` prefix.
 */

/** Migrated and seeded once per `vitest run`; cloned, never written to. */
export const TEMPLATE_DB = "asaph_test_template";

/** Everything this tier is allowed to drop. */
export const TEST_DB_PREFIX = "asaph_test_";

/**
 * What `docker compose up -d db` gives you, which is the whole local setup this
 * tier asks for. Only a fallback: a `DATABASE_URL` in the environment or in
 * `.env.local` wins, and in CI the service container sets it.
 */
const COMPOSE_URL = "postgresql://postgres:mysecretpassword@localhost:5432/asaph";

/** One database per Vitest worker, so the module-level pool in db/client.ts has a server to itself. */
export function workerDbName(poolId: string | undefined): string {
  return `${TEST_DB_PREFIX}w${poolId ?? "1"}`;
}

function baseUrl(): URL {
  return new URL(process.env.DATABASE_URL || COMPOSE_URL);
}

export function urlFor(database: string): string {
  const url = baseUrl();
  url.pathname = `/${database}`;
  return url.toString();
}

/**
 * `CREATE DATABASE` can't run from inside the database being created, and can't
 * run in a transaction, so the clone is driven from a connection to the
 * server's own maintenance database.
 */
export function adminUrl(): string {
  return urlFor("postgres");
}

/** For messages: the server without its credentials. */
export function serverDescription(): string {
  const url = baseUrl();
  return `${url.hostname}:${url.port || "5432"}`;
}
