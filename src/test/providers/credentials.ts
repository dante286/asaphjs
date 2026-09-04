/**
 * The credentials this tier runs on. Every one of them is obviously fake, and
 * that is the point: the provider code is exercised through MSW, so nothing
 * here is ever presented to a real API.
 *
 * TMDB gets two, because `authorize()` picks its auth scheme by matching the
 * key's *shape* — a 32-hex v3 key goes in an `api_key` query parameter and a v4
 * read token goes in an Authorization header. One fake of each shape is what
 * makes both branches reachable.
 */
export const FAKE_IGDB_CLIENT_ID = "fake-igdb-client-id";
export const FAKE_IGDB_CLIENT_SECRET = "fake-igdb-client-secret";
export const FAKE_TMDB_V3_KEY = "0123456789abcdef0123456789abcdef";
export const FAKE_TMDB_V4_TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmYWtlIn0.c2lnbmF0dXJl";
export const FAKE_USER_AGENT = "AsaphJS-Tests/0.1 (provider tier)";

const PROVIDER_ENV = [
  "IGDB_CLIENT_ID",
  "IGDB_CLIENT_SECRET",
  "TMDB_API_KEY",
  "METADATA_USER_AGENT",
] as const;

/**
 * Deleted first, then replaced with the fakes. The delete is not redundant with
 * the assignment: it means a runner that *did* have real credentials in its
 * environment — a developer's shell, a workflow with secrets — cannot leak them
 * into a provider call, so the suite says the same thing everywhere.
 *
 * Called from the setup file, which runs before the test module is imported, so
 * this lands before a provider module reads `process.env` at evaluation time
 * (Open Library's User-Agent is read exactly there).
 */
export function installFakeCredentials(): void {
  for (const name of PROVIDER_ENV) delete process.env[name];

  process.env.IGDB_CLIENT_ID = FAKE_IGDB_CLIENT_ID;
  process.env.IGDB_CLIENT_SECRET = FAKE_IGDB_CLIENT_SECRET;
  process.env.TMDB_API_KEY = FAKE_TMDB_V3_KEY;
  process.env.METADATA_USER_AGENT = FAKE_USER_AGENT;
}
