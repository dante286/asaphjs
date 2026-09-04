import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Candidate, HydratedFields, MetadataProvider } from "./types";

/**
 * The cache layer's two jobs are both about *not* calling the provider: serving
 * a row instead, and collapsing concurrent identical calls onto one request.
 * Neither needs a database to check — mocking four query functions is far
 * cheaper than standing Postgres up, and what's being tested here is this
 * module's decisions, not SQL. The rows' own behaviour has its own tier.
 */
const queries = vi.hoisted(() => ({
  getCachedSearch: vi.fn(),
  setCachedSearch: vi.fn(),
  getCachedHydrate: vi.fn(),
  setCachedHydrate: vi.fn(),
}));

vi.mock("@/db/queries/metadata", () => queries);

const CANDIDATES: Candidate[] = [{ sourceId: "1017", title: "Chrono Trigger", year: 1995 }];
const FIELDS: HydratedFields = { title: "Chrono Trigger", publisher: "Square Soft, Inc." };

/** The version `stampSchema` writes; a payload under any other is a miss. */
const SCHEMA_VERSION = 2;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * `inFlight` is module-level, so a coalesced call from one test would otherwise
 * still be in the map for the next one.
 */
let withCache: typeof import("./cached-provider").withCache;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  // Default to a cache miss; the tests about hits say so themselves.
  queries.getCachedSearch.mockResolvedValue(undefined);
  queries.getCachedHydrate.mockResolvedValue(undefined);
  queries.setCachedSearch.mockResolvedValue(undefined);
  queries.setCachedHydrate.mockResolvedValue(undefined);
  ({ withCache } = await import("./cached-provider"));
});

function stubProvider(over: Partial<MetadataProvider> = {}) {
  return {
    key: "igdb",
    search: vi.fn(async () => CANDIDATES),
    hydrate: vi.fn(async () => FIELDS),
    ...over,
  } satisfies MetadataProvider;
}

/** A provider call the test controls the completion of, for the coalescing cases. */
function deferred<T>() {
  let settle: (value: T) => void = () => {};
  let fail: (reason: unknown) => void = () => {};
  const promise = new Promise<T>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  return { promise, settle, fail };
}

describe("cached search", () => {
  it("serves a fresh row without calling the provider", async () => {
    queries.getCachedSearch.mockResolvedValue({ payload: CANDIDATES, fetchedAt: new Date() });
    const provider = stubProvider();

    expect(await withCache(provider).search("chrono trigger")).toEqual(CANDIDATES);
    expect(provider.search).not.toHaveBeenCalled();
    expect(queries.setCachedSearch).not.toHaveBeenCalled();
  });

  it("refetches a row past the 30-day TTL", async () => {
    // Search rows do expire, slowly: a query that matched nothing, or missed a
    // game announced since, shouldn't be wrong forever.
    queries.getCachedSearch.mockResolvedValue({
      payload: [],
      fetchedAt: new Date(Date.now() - 31 * DAY_MS),
    });
    const provider = stubProvider();

    expect(await withCache(provider).search("chrono trigger")).toEqual(CANDIDATES);
    expect(provider.search).toHaveBeenCalledOnce();
  });

  it("serves a row that is one day short of the TTL", async () => {
    queries.getCachedSearch.mockResolvedValue({
      payload: CANDIDATES,
      fetchedAt: new Date(Date.now() - 29 * DAY_MS),
    });
    const provider = stubProvider();

    await withCache(provider).search("chrono trigger");

    expect(provider.search).not.toHaveBeenCalled();
  });

  it("caches an empty result too", async () => {
    // Re-running searches is what burns a free tier, and a title the provider
    // doesn't have is exactly the query a person retypes.
    const provider = stubProvider({ search: vi.fn(async () => []) });

    await withCache(provider).search("no such game");

    expect(queries.setCachedSearch).toHaveBeenCalledWith("igdb", "no such game", []);
  });
});

describe("cached hydrate", () => {
  it("serves a stamped payload with the stamp stripped off", async () => {
    queries.getCachedHydrate.mockResolvedValue({ payload: { ...FIELDS, __schema: SCHEMA_VERSION } });
    const provider = stubProvider();

    const fields = await withCache(provider).hydrate("1017");

    expect(fields).toEqual(FIELDS);
    expect(fields).not.toHaveProperty("__schema"); // never reaches the prefill plan
    expect(provider.hydrate).not.toHaveBeenCalled();
  });

  it("stamps what it writes, so a later shape change can tell the difference", async () => {
    const provider = stubProvider();

    await withCache(provider).hydrate("1017");

    expect(queries.setCachedHydrate).toHaveBeenCalledWith("igdb", "1017", {
      ...FIELDS,
      __schema: SCHEMA_VERSION,
    });
  });

  it.each([
    ["stamped with an older version", { title: "Stale", __schema: SCHEMA_VERSION - 1 }],
    ["written before there was a stamp", { title: "Stale" }],
  ])("treats a payload %s as a miss", async (_label, payload) => {
    // Hydrate rows never expire, so without this a payload under the old shape
    // would keep filling items from data the provider no longer returns that
    // way, and only "Re-run lookup" would ever fix it.
    queries.getCachedHydrate.mockResolvedValue({ payload });
    const provider = stubProvider();

    expect(await withCache(provider).hydrate("1017")).toEqual(FIELDS);
    expect(provider.hydrate).toHaveBeenCalledOnce();
  });

  it("doesn't even read the row when the caller forces a refresh", async () => {
    // What the item page's "Re-run lookup" button sets — the one bypass, since
    // hydrate rows otherwise never expire.
    queries.getCachedHydrate.mockResolvedValue({ payload: { title: "Stale", __schema: SCHEMA_VERSION } });
    const provider = stubProvider();

    expect(await withCache(provider).hydrate("1017", { forceRefresh: true })).toEqual(FIELDS);
    expect(queries.getCachedHydrate).not.toHaveBeenCalled();
  });
});

describe("in-flight coalescing", () => {
  it("collapses concurrent identical searches onto one provider call", async () => {
    // Without this, a search-as-you-type UI that repeats a query still in
    // flight pays for every one of them: the row only helps once the first
    // response has landed.
    const upstream = deferred<Candidate[]>();
    const provider = stubProvider({ search: vi.fn(() => upstream.promise) });
    const cached = withCache(provider);

    const both = Promise.all([cached.search("chrono trigger"), cached.search("chrono trigger")]);
    upstream.settle(CANDIDATES);

    expect(await both).toEqual([CANDIDATES, CANDIDATES]);
    expect(provider.search).toHaveBeenCalledOnce();
  });

  it("coalesces two spellings of the same query", async () => {
    const upstream = deferred<Candidate[]>();
    const provider = stubProvider({ search: vi.fn(() => upstream.promise) });
    const cached = withCache(provider);

    const both = Promise.all([cached.search("  Chrono Trigger"), cached.search("chrono trigger ")]);
    upstream.settle(CANDIDATES);
    await both;

    expect(provider.search).toHaveBeenCalledOnce();
  });

  it("keeps different queries apart", async () => {
    const provider = stubProvider();
    const cached = withCache(provider);

    await Promise.all([cached.search("chrono"), cached.search("chrono trigger")]);

    expect(provider.search).toHaveBeenCalledTimes(2);
  });

  it("keeps a forced refresh out of the flight a cached read started", async () => {
    // Both are in flight for the same id, but only one of them is allowed to be
    // answered from a row — so they can't share a promise.
    const upstream = deferred<HydratedFields>();
    const provider = stubProvider({ hydrate: vi.fn(() => upstream.promise) });
    const cached = withCache(provider);

    const both = Promise.all([cached.hydrate("1017"), cached.hydrate("1017", { forceRefresh: true })]);
    upstream.settle(FIELDS);
    await both;

    expect(provider.hydrate).toHaveBeenCalledTimes(2);
  });

  it("lets a later call through once the first has settled", async () => {
    const provider = stubProvider();
    const cached = withCache(provider);

    await cached.search("chrono trigger");
    await cached.search("chrono trigger");

    // The map is keyed on the query, not a cache of it — leaving an entry
    // behind would answer tomorrow's search with today's promise.
    expect(provider.search).toHaveBeenCalledTimes(2);
  });

  it("hands one failure to every caller waiting on it", async () => {
    const upstream = deferred<Candidate[]>();
    const provider = stubProvider({ search: vi.fn(() => upstream.promise) });
    const cached = withCache(provider);

    const first = cached.search("chrono trigger");
    const second = cached.search("chrono trigger");
    upstream.fail(new Error("IGDB games failed: 500"));

    await expect(first).rejects.toThrow("IGDB games failed: 500");
    await expect(second).rejects.toThrow("IGDB games failed: 500");
  });

  it("clears the flight after a failure rather than caching the rejection", async () => {
    // A provider blip would otherwise pin a rejected promise in the map, and
    // every retry of that query would fail without a request being made.
    const provider = stubProvider({
      search: vi.fn().mockRejectedValueOnce(new Error("IGDB games failed: 500")).mockResolvedValue(CANDIDATES),
    });
    const cached = withCache(provider);

    await expect(cached.search("chrono trigger")).rejects.toThrow("IGDB games failed: 500");

    expect(await cached.search("chrono trigger")).toEqual(CANDIDATES);
    expect(provider.search).toHaveBeenCalledTimes(2);
  });

  it("doesn't write a row for a call that failed", async () => {
    const provider = stubProvider({ search: vi.fn(async () => Promise.reject(new Error("boom"))) });

    await expect(withCache(provider).search("chrono trigger")).rejects.toThrow("boom");

    expect(queries.setCachedSearch).not.toHaveBeenCalled();
  });
});
