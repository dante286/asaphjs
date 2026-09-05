import { and, eq } from "drizzle-orm";
import { delay, http, HttpResponse, type HttpHandler } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/client";
import { metadataCache, metadataSearchCache } from "@/db/schema";
import { interceptProviderNetwork, providerServer } from "@/test/db/providers";
import { FAKE_IGDB_CLIENT_ID, FAKE_IGDB_CLIENT_SECRET } from "@/test/providers/credentials";
import {
  IGDB_CHRONO_TRIGGER_ID,
  IGDB_SEARCH_DOCS,
  OL_SEARCH_DOCS,
  OL_WORK_KEY,
} from "@/test/providers/fixtures";
import { IGDB_GAMES_URL, OPENLIBRARY_BASE_URL } from "@/test/providers/handlers";
import { recordedRequests } from "@/test/providers/requests";
import type { ProviderKey } from "./types";

/**
 * The automated half of `npm run lookup:check`. That script counts outbound
 * requests around each call and asserts seven things about them, but it needs
 * real credentials, a real provider and a human to read its output — so the
 * cache the README calls "the feature, not an optimization" ran unprotected
 * between runs (#35).
 *
 * What makes this worth a third spec rather than a duplicate of two that exist:
 *
 * `cached-provider.test.ts` mocks the four query functions and counts calls on
 * a stub provider, so it covers this module's *decisions* — the TTL
 * comparison, the schema stamp, the single-flight map — and does that far more
 * thoroughly than a Postgres-backed spec should try to. `metadata.db.test.ts`
 * covers the two tables underneath: the upsert on each unique key, the query
 * normalisation, the jsonb round-trip. Both of them pass in a world where
 * `getProvider` hands back an unwrapped provider and the cache is never
 * consulted at all.
 *
 * So what's asserted here is the thing neither can see: how many requests
 * actually leave the process, through the real registry, the real provider code
 * and real rows. A hit and a miss return identical fields — the request count
 * is the only observable difference between them, and it is the unit the free
 * tier is spent in.
 *
 * Two providers, because the assertion that has to tolerate both is "a cold
 * hydrate costs at least one request": Open Library reads the work, its
 * search-index doc and its series record, while IGDB reads one game.
 *
 * The script stays, and so does the README section about it. MSW fixtures are
 * written by us against types we declared, so by construction they cannot
 * notice a provider changing its response shape. That is the script's job; this
 * file's job is our own regressions.
 */

/**
 * The same pass-through the providers tier and the lookup specs install: Open
 * Library's real limiter is one request a second and a hydrate makes three, so
 * the real one would buy seconds of queueing and no signal about caching.
 */
vi.mock("@/lib/metadata/rate-limiter", () => ({
  getLimiter: () => ({ schedule: <T>(task: () => Promise<T>) => task() }),
}));

/**
 * After the mock above, because the registry wraps every provider at module
 * evaluation and each provider builds its limiter there. Reached through the
 * registry rather than by calling `withCache` directly, on purpose: that the
 * registry wraps at all is one of the things being tested here, and it is
 * invisible to every other spec.
 */
const { getProvider } = await import("@/lib/metadata/providers");

interceptProviderNetwork();

/**
 * IGDB is unconfigured in this tier — the setup file blanks its credentials and
 * the CI job pins them empty, so `isProviderConfigured()` is false here the way
 * it is on an instance whose owner never set a key. Both provider modules read
 * `process.env` at call time rather than at evaluation, so a stub per test is
 * all it takes to make this the one file where IGDB is reachable.
 */
beforeEach(() => {
  vi.stubEnv("IGDB_CLIENT_ID", FAKE_IGDB_CLIENT_ID);
  vi.stubEnv("IGDB_CLIENT_SECRET", FAKE_IGDB_CLIENT_SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/**
 * Twitch's token endpoint, excluded for the same reason the script excludes it:
 * the app token is cached in a module-level variable and amortized across every
 * IGDB call in the process, so counting it would charge it to whichever test
 * ran first and make every other count depend on file order.
 */
const TOKEN_HOST = "id.twitch.tv";

async function providerRequests(): Promise<string[]> {
  return (await recordedRequests())
    .filter((r) => r.url.hostname !== TOKEN_HOST)
    .map((r) => `${r.method} ${r.url.hostname}${r.url.pathname}`);
}

/**
 * What one call spent, rather than a running total: the recorder collects for
 * the whole test, so a test that acts twice reads the second act's cost by
 * difference. Returns the request lines and not just a count, so a wrong number
 * fails with the URLs that made it up.
 */
async function spentDuring<T>(work: () => Promise<T>): Promise<{ result: T; requests: string[] }> {
  const before = (await providerRequests()).length;
  const result = await work();
  return { result, requests: (await providerRequests()).slice(before) };
}

/** `normalizeQuery` is private to the query module; this is the same rule. */
function normalized(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * The TTL is private to `cached-provider.ts`, so this spec names it
 * independently — a test that read the constant would agree with a typo in it.
 * 30 days is what the README documents and what the comment on `SEARCH_TTL_MS`
 * explains: slow enough that re-running searches doesn't burn the free tier,
 * finite so a query that matched nothing isn't wrong forever.
 */
const SEARCH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

const STALE_PAYLOAD = { title: "stale", __schema: 0 };

/** Backdates a cached search row — the TTL boundary without faking the clock. */
async function ageSearchRow(source: ProviderKey, query: string, byMs: number): Promise<void> {
  const aged = await db
    .update(metadataSearchCache)
    .set({ fetchedAt: new Date(Date.now() - byMs) })
    .where(
      and(
        eq(metadataSearchCache.source, source),
        eq(metadataSearchCache.queryNormalized, normalized(query)),
      ),
    )
    .returning({ id: metadataSearchCache.id });

  // A no-op update would leave the next assertion passing for the wrong reason:
  // a row that was never written looks exactly like a row that is still fresh.
  expect(aged).toHaveLength(1);
}

/** Rewrites a hydrate row under a payload shape this version of the code doesn't recognise. */
async function staleTheHydrateRow(source: ProviderKey, sourceId: string): Promise<void> {
  const stamped = await db
    .update(metadataCache)
    .set({ payload: STALE_PAYLOAD })
    .where(and(eq(metadataCache.source, source), eq(metadataCache.sourceId, sourceId)))
    .returning({ id: metadataCache.id });

  expect(stamped).toHaveLength(1);
}

function searchRow(source: ProviderKey, query: string) {
  return db.query.metadataSearchCache.findFirst({
    where: and(
      eq(metadataSearchCache.source, source),
      eq(metadataSearchCache.queryNormalized, normalized(query)),
    ),
  });
}

function hydrateRow(source: ProviderKey, sourceId: string) {
  return db.query.metadataCache.findFirst({
    where: and(eq(metadataCache.source, source), eq(metadataCache.sourceId, sourceId)),
  });
}

type ProviderCase = {
  key: ProviderKey;
  query: string;
  /** A second query the fixtures answer identically — the burst needs one nothing has cached. */
  burstQuery: string;
  sourceId: string;
  /** What a cold hydrate costs today: Open Library reads three records, IGDB one. */
  coldHydrateRequests: number;
  /** That provider answering a query it has nothing for. */
  noResults: () => HttpHandler;
  /** The usual answer, held open long enough for a burst to fan out behind it. */
  slowSearch: () => HttpHandler;
};

/**
 * Long enough that five cache reads over already-open pool connections all
 * land inside it, short enough to be invisible beside this tier's 20s timeout.
 */
const HELD_OPEN_MS = 100;

const CASES: ProviderCase[] = [
  {
    key: "openlibrary",
    query: "frieren",
    burstQuery: "frieren beyond journeys end",
    sourceId: OL_WORK_KEY,
    coldHydrateRequests: 3,
    noResults: () =>
      http.get(`${OPENLIBRARY_BASE_URL}/search.json`, () => HttpResponse.json({ docs: [] })),
    slowSearch: () =>
      http.get(`${OPENLIBRARY_BASE_URL}/search.json`, async () => {
        await delay(HELD_OPEN_MS);
        return HttpResponse.json({ docs: OL_SEARCH_DOCS });
      }),
  },
  {
    key: "igdb",
    query: "chrono trigger",
    burstQuery: "chrono trigger snes",
    sourceId: String(IGDB_CHRONO_TRIGGER_ID),
    coldHydrateRequests: 1,
    // IGDB serves search and hydrate off one endpoint, told apart by the
    // APICalypse body. Nothing under this override hydrates.
    noResults: () => http.post(IGDB_GAMES_URL, () => HttpResponse.json([])),
    slowSearch: () =>
      http.post(IGDB_GAMES_URL, async () => {
        await delay(HELD_OPEN_MS);
        return HttpResponse.json(IGDB_SEARCH_DOCS);
      }),
  },
];

describe.each(CASES)("$key, counted end to end", (subject) => {
  const { key, query, burstQuery, sourceId, coldHydrateRequests } = subject;

  describe("search", () => {
    it("spends one request when nothing is cached", async () => {
      const { result, requests } = await spentDuring(() => getProvider(key).search(query));

      expect(result.length).toBeGreaterThan(0);
      expect(requests).toHaveLength(1);
      expect(await searchRow(key, query)).toBeTruthy();
    });

    it("spends nothing the second time, and answers the same", async () => {
      const cold = await getProvider(key).search(query);

      const { result, requests } = await spentDuring(() => getProvider(key).search(query));

      expect(requests).toEqual([]);
      // Through jsonb and back, so a column type that mangled a candidate shows
      // up here rather than against a hand-written payload.
      expect(result).toEqual(cold);
    });

    it("collapses five identical in-flight searches onto one request", async () => {
      // The row only helps once the first response has landed, so a
      // search-as-you-type UI repeating a query still in flight is the case the
      // single-flight map exists for.
      //
      // Both lines of setup below are load-bearing, and this test passed for
      // the wrong reason without them. The response is held open, so the first
      // call cannot write its row while the other four are still fanning out;
      // and the pool is warmed first, so those four read over connections that
      // already exist. Cold, the openlibrary burst counted one request even
      // with `single()` deleted — opening four more Postgres connections took
      // longer than MSW's in-process reply, so calls two to five read the row
      // call one had already written, and the test proved nothing.
      providerServer.use(subject.slowSearch());
      await Promise.all(Array.from({ length: 5 }, () => searchRow(key, burstQuery)));

      const { result, requests } = await spentDuring(() =>
        Promise.all(Array.from({ length: 5 }, () => getProvider(key).search(burstQuery))),
      );

      expect(requests).toHaveLength(1);
      // All five were answered, not just the one that paid for it.
      for (const candidates of result) expect(candidates).toEqual(result[0]);
    });

    it("serves a row a minute short of the 30-day TTL", async () => {
      await getProvider(key).search(query);
      await ageSearchRow(key, query, SEARCH_TTL_MS - MINUTE_MS);

      const { requests } = await spentDuring(() => getProvider(key).search(query));

      expect(requests).toEqual([]);
    });

    it("refetches a row a minute past it", async () => {
      // Slowly, but not never: a query that matched nothing, or missed
      // something announced since, shouldn't be wrong forever.
      await getProvider(key).search(query);
      await ageSearchRow(key, query, SEARCH_TTL_MS + MINUTE_MS);

      const { requests } = await spentDuring(() => getProvider(key).search(query));

      expect(requests).toHaveLength(1);
    });

    it("caches a query the provider has nothing for", async () => {
      // A miss is exactly the query someone retypes, so not caching it leaves
      // an unmatched title costing a request every time it's asked.
      providerServer.use(subject.noResults());

      const cold = await spentDuring(() => getProvider(key).search("no such thing"));
      expect(cold.result).toEqual([]);
      expect(cold.requests).toHaveLength(1);
      expect(await searchRow(key, "no such thing")).toMatchObject({ payload: [] });

      const warm = await spentDuring(() => getProvider(key).search("no such thing"));
      expect(warm.result).toEqual([]);
      expect(warm.requests).toEqual([]);
    });
  });

  describe("hydrate", () => {
    it("spends what its provider's records cost when nothing is cached", async () => {
      const { result, requests } = await spentDuring(() => getProvider(key).hydrate(sourceId));

      expect(result.title).toBeTruthy();
      // "At least one" is the shared claim, but the exact number is what the
      // cache is measured against — an extra record read is a real cost even
      // when it isn't a bug, and this is where it would surface.
      expect(requests).toHaveLength(coldHydrateRequests);
      expect(await hydrateRow(key, sourceId)).toBeTruthy();
    });

    it("spends nothing the second time, and answers the same", async () => {
      const cold = await getProvider(key).hydrate(sourceId);

      const { result, requests } = await spentDuring(() => getProvider(key).hydrate(sourceId));

      expect(requests).toEqual([]);
      expect(result).toEqual(cold);
      expect(result).not.toHaveProperty("__schema"); // the stamp never reaches a prefill plan
    });

    it("spends a request again when the caller forces a refresh", async () => {
      // The item page's "Re-run lookup" button. Hydrate rows never expire, so
      // this is the only way a payload is replaced on purpose.
      await getProvider(key).hydrate(sourceId);

      const { requests } = await spentDuring(() =>
        getProvider(key).hydrate(sourceId, { forceRefresh: true }),
      );

      expect(requests).toHaveLength(coldHydrateRequests);
    });

    it("refetches a row stamped with an older payload shape", async () => {
      // The assertion that earns this file. Hydrate rows never expire, so a
      // provider that starts returning different canonical keys leaves every
      // cached payload permanently stale unless PAYLOAD_SCHEMA_VERSION is
      // bumped — and the PR template's checkbox for that is only as good as
      // whoever reads it. Delete the version check in `readStamped` and this
      // goes red.
      const fresh = await getProvider(key).hydrate(sourceId);
      await staleTheHydrateRow(key, sourceId);

      const { result, requests } = await spentDuring(() => getProvider(key).hydrate(sourceId));

      expect(requests).toHaveLength(coldHydrateRequests);
      expect(result).toEqual(fresh);
      expect(result.title).not.toBe("stale");
    });

    it("writes the refetch back, so a stale row costs one refetch and not one per lookup", async () => {
      // A refetch that didn't replace the row would pass the test above and
      // still cost the same as having no cache at all.
      await getProvider(key).hydrate(sourceId);
      await staleTheHydrateRow(key, sourceId);
      await getProvider(key).hydrate(sourceId);

      const { requests } = await spentDuring(() => getProvider(key).hydrate(sourceId));

      expect(requests).toEqual([]);
    });
  });
});

/**
 * One check rather than a per-provider one: both tables are keyed on
 * `(source, id)`, and a key that dropped `source` would serve one provider's
 * payload for another's id.
 */
describe("the two providers' rows", () => {
  it("are kept apart by source", async () => {
    await getProvider("openlibrary").hydrate(OL_WORK_KEY);

    const { requests } = await spentDuring(() =>
      getProvider("igdb").hydrate(String(IGDB_CHRONO_TRIGGER_ID)),
    );

    expect(requests).toHaveLength(1);
    expect(await hydrateRow("igdb", String(IGDB_CHRONO_TRIGGER_ID))).toBeTruthy();
    expect(await hydrateRow("openlibrary", OL_WORK_KEY)).toBeTruthy();
  });
});
