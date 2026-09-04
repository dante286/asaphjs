import { describe, expect, it } from "vitest";
import { getCachedHydrate, getCachedSearch, setCachedHydrate, setCachedSearch } from "./metadata";

/**
 * The rows behind `withCache`. Its own decisions — the schema stamp, the TTL,
 * the single-flight coalescing — are tested with these four functions mocked in
 * the unit tier; what's left, and what needs Postgres, is the upsert on each
 * table's unique key and the query normalisation that decides whether two
 * searches are the same search.
 *
 * These tables are the reason `npm run lookup:check` can prove a lookup costs
 * one provider request rather than one per keystroke, so a broken upsert here
 * would quietly turn the cache into a write-only log.
 */

describe("the hydrate cache", () => {
  it("stores and reads back a payload for one provider and id", async () => {
    await setCachedHydrate("igdb", "1017", { title: "Chrono Trigger", __schema: 2 });

    const row = await getCachedHydrate("igdb", "1017");

    expect(row).toMatchObject({
      source: "igdb",
      sourceId: "1017",
      payload: { title: "Chrono Trigger", __schema: 2 },
    });
    expect(row?.fetchedAt).toBeInstanceOf(Date);
  });

  it("replaces the payload and moves fetchedAt on a second write", async () => {
    await setCachedHydrate("igdb", "1017", { title: "Old" });
    const first = await getCachedHydrate("igdb", "1017");

    await setCachedHydrate("igdb", "1017", { title: "New" });
    const second = await getCachedHydrate("igdb", "1017");

    // The upsert is what "Re-run lookup" relies on: a forced refresh has to
    // overwrite the row it bypassed, not add a second one.
    expect(second?.payload).toEqual({ title: "New" });
    expect(second!.fetchedAt.getTime()).toBeGreaterThanOrEqual(first!.fetchedAt.getTime());
  });

  it("keys on the provider as well as the id", async () => {
    // "1017" means a different thing to each provider, and TMDB's own ids are
    // namespaced only by the `movie:`/`tv:` prefix — so the source is half the key.
    await setCachedHydrate("igdb", "1017", { title: "Chrono Trigger" });
    await setCachedHydrate("openlibrary", "1017", { title: "Some Book" });

    expect((await getCachedHydrate("igdb", "1017"))?.payload).toEqual({ title: "Chrono Trigger" });
    expect((await getCachedHydrate("openlibrary", "1017"))?.payload).toEqual({ title: "Some Book" });
  });

  it("answers nothing for an id it has never seen", async () => {
    expect(await getCachedHydrate("igdb", "404")).toBeUndefined();
  });

  it("stores a payload with nested provider data intact", async () => {
    const payload = {
      title: "Chrono Trigger",
      platforms: ["SNES", "NDS"],
      genre: [],
      series: null,
      nested: { deep: { value: 1 } },
      __schema: 2,
    };

    await setCachedHydrate("igdb", "1017", payload);

    // jsonb round-trip: arrays stay arrays, an empty one stays empty, and null
    // is a value rather than an absent key.
    expect((await getCachedHydrate("igdb", "1017"))?.payload).toEqual(payload);
  });
});

describe("the search cache", () => {
  it("stores and reads back a candidate list", async () => {
    const candidates = [{ sourceId: "1017", title: "Chrono Trigger", year: 1995 }];

    await setCachedSearch("igdb", "chrono trigger", candidates);

    expect((await getCachedSearch("igdb", "chrono trigger"))?.payload).toEqual(candidates);
  });

  it.each([
    ["  chrono trigger  ", "leading and trailing space"],
    ["Chrono Trigger", "capitals"],
    ["chrono   trigger", "a run of spaces"],
    ["\tChrono\nTrigger ", "tabs and newlines"],
  ])("treats %j as the same query (%s)", async (variant) => {
    await setCachedSearch("igdb", "chrono trigger", [{ sourceId: "1017", title: "Chrono Trigger" }]);

    // Search-as-you-type sends the same query in many shapes; normalising on
    // the way in and out is what stops each one costing a provider request.
    expect((await getCachedSearch("igdb", variant))?.payload).toHaveLength(1);
  });

  it("normalises what it writes, so two spellings share one row", async () => {
    await setCachedSearch("igdb", "  Chrono   Trigger ", [{ sourceId: "1017", title: "First" }]);
    await setCachedSearch("igdb", "chrono trigger", [{ sourceId: "1017", title: "Second" }]);

    expect((await getCachedSearch("igdb", "CHRONO TRIGGER"))?.payload).toEqual([
      { sourceId: "1017", title: "Second" },
    ]);
  });

  it("keeps different queries apart", async () => {
    await setCachedSearch("igdb", "chrono", [{ sourceId: "1", title: "Chrono" }]);
    await setCachedSearch("igdb", "chrono trigger", [{ sourceId: "2", title: "Chrono Trigger" }]);

    expect((await getCachedSearch("igdb", "chrono"))?.payload).toEqual([
      { sourceId: "1", title: "Chrono" },
    ]);
  });

  it("keys on the provider too", async () => {
    await setCachedSearch("igdb", "chrono trigger", [{ sourceId: "1017", title: "Game" }]);

    expect(await getCachedSearch("tmdb", "chrono trigger")).toBeUndefined();
  });

  it("caches an empty result as a result", async () => {
    // The point of caching a miss: a title the provider doesn't have is
    // exactly the query someone retypes.
    await setCachedSearch("igdb", "no such game", []);

    const row = await getCachedSearch("igdb", "no such game");
    expect(row).toBeTruthy();
    expect(row?.payload).toEqual([]);
  });

  it("answers nothing for a query it has never seen", async () => {
    expect(await getCachedSearch("igdb", "never asked")).toBeUndefined();
  });
});
