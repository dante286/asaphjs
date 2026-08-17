import { config } from "dotenv";

// Same reason as scripts/seed/run.ts: load env here, not via a POSIX-only
// `-r dotenv/config` prefix on the npm script.
config({ path: ".env.local" });

/**
 * Proves the metadata cache actually spares the provider's free tier, by counting
 * outbound requests around each call rather than trusting that a cache row exists.
 *
 *   npm run lookup:check            # igdb, "chrono trigger"
 *   npm run lookup:check -- openlibrary "dune"
 *
 * Deletes only the cache rows for the query and source id it tests, so a real
 * collection's cached lookups survive a run.
 */
const [providerArg, ...queryArgs] = process.argv.slice(2);
const PROVIDER = providerArg ?? "igdb";
const QUERY = queryArgs.join(" ") || "chrono trigger";

// Provider hosts only — the token endpoint is counted separately since it's
// amortized across every call in the process, not per lookup.
const TOKEN_HOSTS = ["id.twitch.tv"];

let calls: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  calls.push(url);
  return realFetch(input, init);
}) as typeof fetch;

function outbound(): { provider: number; token: number } {
  const token = calls.filter((u) => TOKEN_HOSTS.some((h) => u.includes(h))).length;
  return { provider: calls.length - token, token };
}

function reset() {
  calls = [];
}

let failures = 0;

function check(label: string, ok: boolean, detail: string) {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label} (${detail})`);
}

function checkCalls(label: string, expected: number) {
  const actual = outbound().provider;
  check(label, actual === expected, `${actual} provider request(s), expected ${expected}`);
}

/**
 * Cold calls are "at least one", not "exactly one": Open Library's hydrate reads
 * the work, its search-index doc and its series record, while IGDB's is a single
 * query. What matters is that the warm path is 0.
 */
function checkUncached(label: string) {
  const actual = outbound().provider;
  check(label, actual >= 1, `${actual} provider request(s), expected at least 1`);
}

/** Key-order-insensitive: Postgres jsonb doesn't round-trip object key order. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

async function main() {
  const { and, eq } = await import("drizzle-orm");
  // Dynamic, like the seed script: db/client.ts reads DATABASE_URL at module eval.
  const { db } = await import("@/db/client");
  const { metadataCache, metadataSearchCache } = await import("@/db/schema");
  const { getProvider } = await import("@/lib/metadata/providers");
  const { providerKeySchema } = await import("@/lib/metadata/types");

  const key = providerKeySchema.parse(PROVIDER);
  const provider = getProvider(key);
  const normalized = QUERY.trim().toLowerCase().replace(/\s+/g, " ");

  const purgeSearch = (q: string) =>
    db
      .delete(metadataSearchCache)
      .where(and(eq(metadataSearchCache.source, key), eq(metadataSearchCache.queryNormalized, q)));

  console.log(`Provider: ${key}   query: "${QUERY}"\n`);

  console.log("1. cold search (cache purged)");
  await purgeSearch(normalized);
  reset();
  const first = await provider.search(QUERY);
  const tokenRequests = outbound().token;
  console.log(`  ${first.length} candidate(s), ${tokenRequests} token request(s)`);
  checkCalls("cold search hits the provider", 1);
  if (first.length === 0) {
    console.log("  (no candidates — pick a query the provider knows, or the rest proves little)");
  }

  console.log("2. warm search (same query again)");
  reset();
  const second = await provider.search(QUERY);
  checkCalls("warm search is served from Postgres", 0);
  check(
    "warm search returns the same candidates",
    stable(second) === stable(first),
    `${second.length} candidate(s) back`,
  );

  console.log("3. five concurrent cold searches (single-flight)");
  const burstQuery = `${QUERY} ${new Date().toISOString().slice(0, 10)}`; // uncached, deterministic within a day
  await purgeSearch(burstQuery.trim().toLowerCase().replace(/\s+/g, " "));
  reset();
  await Promise.all(Array.from({ length: 5 }, () => provider.search(burstQuery)));
  checkCalls("five identical in-flight searches collapse to one", 1);
  await purgeSearch(burstQuery.trim().toLowerCase().replace(/\s+/g, " "));

  const sourceId = first[0]?.sourceId;
  if (!sourceId) {
    console.log("\nSkipping hydrate checks — the search returned nothing to hydrate.");
  } else {
    console.log(`4. cold hydrate (source id ${sourceId}, cache purged)`);
    await db
      .delete(metadataCache)
      .where(and(eq(metadataCache.source, key), eq(metadataCache.sourceId, sourceId)));
    reset();
    const hydrated = await provider.hydrate(sourceId);
    checkUncached("cold hydrate hits the provider");
    console.log(`  payload keys: ${Object.keys(hydrated).join(", ")}`);

    console.log("5. warm hydrate");
    reset();
    await provider.hydrate(sourceId);
    checkCalls("warm hydrate is served from Postgres", 0);

    console.log("6. forced refresh (the 'Re-run lookup' button)");
    reset();
    await provider.hydrate(sourceId, { forceRefresh: true });
    checkUncached("forceRefresh deliberately bypasses the cache");

    console.log("7. a row cached under an older payload shape");
    // Hydrate rows never expire, so a provider that starts returning new keys
    // has to invalidate what's already cached — otherwise only "Re-run lookup"
    // would ever pick the new shape up.
    await db
      .update(metadataCache)
      .set({ payload: { title: "stale", __schema: 0 } })
      .where(and(eq(metadataCache.source, key), eq(metadataCache.sourceId, sourceId)));
    reset();
    const refreshed = await provider.hydrate(sourceId);
    checkUncached("a stale-schema row is refetched, not served");
    check(
      "the refetched payload replaced the stale one",
      refreshed.title !== "stale",
      `title is ${JSON.stringify(refreshed.title)}`,
    );
  }

  const [searchRows, hydrateRows] = await Promise.all([
    db.select().from(metadataSearchCache).where(eq(metadataSearchCache.source, key)),
    db.select().from(metadataCache).where(eq(metadataCache.source, key)),
  ]);
  console.log(
    `\nCache rows for ${key}: ${searchRows.length} search, ${hydrateRows.length} hydrate` +
      ` (${calls.length} request(s) in the last step)`,
  );

  console.log(failures === 0 ? "\nAll cache checks passed." : `\n${failures} cache check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
