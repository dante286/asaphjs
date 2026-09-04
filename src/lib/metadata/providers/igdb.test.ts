import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FAKE_IGDB_CLIENT_ID, FAKE_IGDB_CLIENT_SECRET } from "@/test/providers/credentials";
import { IGDB_CHRONO_TRIGGER, IGDB_CHRONO_TRIGGER_ID } from "@/test/providers/fixtures";
import { IGDB_GAMES_URL, TWITCH_APP_TOKEN, TWITCH_TOKEN_URL } from "@/test/providers/handlers";
import { recordedRequests, requestsTo } from "@/test/providers/requests";
import { server } from "@/test/providers/server";
import type { IgdbGame } from "./igdb";

/**
 * The provider code runs unmodified — MSW answers below `fetch`, so the URLs,
 * the APICalypse body, the Client-ID and Bearer headers and the JSON parsing
 * are all the real ones. What's asserted here is the part that only shows up
 * against a real response: every mapping in this file encodes an IGDB quirk
 * that was learned the hard way, and each is a silent-wrong-data bug if it
 * regresses.
 *
 * `igdb.ts` caches the Twitch app token in a module-level variable that would
 * otherwise carry from one test into the next, so each test gets a freshly
 * evaluated module and therefore no token.
 */
let igdb: typeof import("./igdb");

beforeEach(async () => {
  vi.resetModules();
  igdb = await import("./igdb");
});

function igdbGames(...rows: IgdbGame[]) {
  return http.post(IGDB_GAMES_URL, () => HttpResponse.json(rows));
}

async function igdbQueryBody(): Promise<string> {
  const [request] = await requestsTo("api.igdb.com");
  return request.body;
}

describe("igdbProvider.search", () => {
  it("maps a game onto a candidate", async () => {
    const [candidate] = await igdb.igdbProvider.search("chrono trigger");

    expect(candidate).toEqual({
      sourceId: "1017", // a string, because every provider's ids have to be
      title: "Chrono Trigger",
      // first_release_date is Unix *seconds*; read as milliseconds this would
      // be January 1970.
      year: 1995,
      // Abbreviations, four of the fixture's five: platform is what tells the
      // SNES cartridge apart from the 2018 PC port in the picker, and a
      // seven-platform release would otherwise fill the row.
      subtitle: "SNES · NDS · PC · Android",
      // t_thumb rewritten to t_cover_big, and the protocol-relative URL given
      // a scheme — IGDB returns t_thumb whatever size was asked for.
      coverUrl: "https://images.igdb.com/igdb/image/upload/t_cover_big/co2i5f.jpg",
    });
  });

  it("drops the rows IGDB indexes with no name", async () => {
    const candidates = await igdb.igdbProvider.search("chrono trigger");

    expect(candidates.map((c) => c.sourceId)).toEqual(["1017", "138299"]);
  });

  it("leaves year, subtitle and cover absent when IGDB has none of them", async () => {
    const candidate = (await igdb.igdbProvider.search("chrono trigger")).at(-1);

    expect(candidate).toEqual({
      sourceId: "138299",
      title: "Chrono Trigger: Prophet's Guile",
      year: undefined,
      subtitle: undefined,
      coverUrl: undefined,
    });
  });

  it("asks for shelf game types only, ten at a time", async () => {
    await igdb.igdbProvider.search("chrono trigger");

    const body = await igdbQueryBody();
    // Unfiltered, `search` ranks three Satellaview add-ons above the 1995 SNES
    // cartridge — the filter is what makes the picker usable.
    expect(body).toContain("where game_type = (0,8,9,10,11);");
    expect(body).toContain('search "chrono trigger";');
    expect(body).toContain("limit 10;");
  });

  it("neutralises the characters that would end the APICalypse clause early", async () => {
    // A quote or a semicolon in a title would terminate the search clause and
    // change the query — the rest of the string would be read as more clauses.
    await igdb.igdbProvider.search('say "hi"; where id = 1');

    expect(await igdbQueryBody()).toContain('search "say hi where id = 1";');
  });

  it("caps the term at 100 characters", async () => {
    await igdb.igdbProvider.search("a".repeat(150));

    expect(await igdbQueryBody()).toContain(`search "${"a".repeat(100)}";`);
  });

  it("asks nothing at all for a term that sanitises to empty", async () => {
    // Not even the token request: the guard is before igdbQuery, so an empty
    // search-as-you-type keystroke costs nothing against the free tier.
    expect(await igdb.igdbProvider.search(' ";; ')).toEqual([]);
    expect(await recordedRequests()).toEqual([]);
  });
});

describe("igdbProvider.hydrate", () => {
  it("maps a game onto canonical fields", async () => {
    const fields = await igdb.igdbProvider.hydrate(String(IGDB_CHRONO_TRIGGER_ID));

    expect(fields).toEqual({
      title: "Chrono Trigger",
      // The publisher is the fixture's *second* involved company and the
      // developer its first, so a mapping that reached for either end of the
      // array would fail one of these.
      publisher: "Square Soft, Inc.",
      developer: "Square",
      // Not capped here, unlike the picker's subtitle — the field gets them all.
      platforms: ["SNES", "NDS", "PC", "Android", "iOS"],
      genre: ["Role-playing (RPG)", "Adventure"],
      series: "Chrono",
      releaseDate: "1995-03-11",
      year: 1995,
      summary: IGDB_CHRONO_TRIGGER.summary,
      coverUrl: "https://images.igdb.com/igdb/image/upload/t_cover_big/co2i5f.jpg",
      sourceUrl: "https://www.igdb.com/games/chrono-trigger",
    });
  });

  it("falls back to the first involved company when IGDB flags neither role", async () => {
    // IGDB's involved_companies routinely has no entry flagged publisher —
    // naming the one company it does know beats leaving the field empty.
    server.use(
      igdbGames({
        ...IGDB_CHRONO_TRIGGER,
        involved_companies: [{ company: { name: "Squaresoft" }, publisher: false, developer: false }],
      }),
    );

    const fields = await igdb.igdbProvider.hydrate("1017");

    expect(fields.publisher).toBe("Squaresoft");
    expect(fields.developer).toBe("Squaresoft");
  });

  it("falls back to a collection when the game belongs to no franchise", async () => {
    server.use(igdbGames({ ...IGDB_CHRONO_TRIGGER, franchises: undefined }));

    expect((await igdb.igdbProvider.hydrate("1017")).series).toBe("Chrono Trigger Collection");
  });

  it("leaves the release date absent rather than inventing one", async () => {
    server.use(igdbGames({ ...IGDB_CHRONO_TRIGGER, first_release_date: undefined }));

    const fields = await igdb.igdbProvider.hydrate("1017");

    expect(fields.releaseDate).toBeUndefined();
    expect(fields.year).toBeUndefined();
  });

  it("fills what a sparsely indexed game allows and invents nothing", async () => {
    // Most of IGDB's long tail looks like this. Every field is optional in the
    // response, and hydrate has to come back with a usable object anyway.
    server.use(igdbGames({ id: 138_299, name: "Chrono Trigger: Prophet's Guile" }));

    expect(await igdb.igdbProvider.hydrate("138299")).toEqual({
      title: "Chrono Trigger: Prophet's Guile",
      publisher: undefined,
      developer: undefined,
      platforms: [],
      genre: [],
      series: undefined,
      releaseDate: undefined,
      year: undefined,
      summary: undefined,
      coverUrl: undefined,
      sourceUrl: undefined,
    });
  });

  it("writes a platform's full name when IGDB has no abbreviation for it", async () => {
    server.use(igdbGames({ ...IGDB_CHRONO_TRIGGER, platforms: [{ name: "Satellaview" }] }));

    // The abbreviation is preferred because it's what a collector writes on a
    // shelf label, but a platform without one still belongs in the field.
    expect((await igdb.igdbProvider.hydrate("1017")).platforms).toEqual(["Satellaview"]);
  });

  it("rejects an id that isn't a number before asking IGDB", async () => {
    // The id is interpolated straight into the query, so this is the check that
    // keeps a cached sourceId from becoming an APICalypse injection.
    await expect(igdb.igdbProvider.hydrate("1017; where id = 2")).rejects.toThrow(/Invalid IGDB id/);
    expect(await recordedRequests()).toEqual([]);
  });

  it("throws when IGDB answers 200 with no rows", async () => {
    // A deleted or merged game — 200 and an empty array, not a 404.
    await expect(igdb.igdbProvider.hydrate("999999")).rejects.toThrow("IGDB game 999999 not found");
  });
});

describe("the Twitch app token", () => {
  it("is fetched once and reused across calls", async () => {
    await igdb.igdbProvider.search("chrono trigger");
    await igdb.igdbProvider.hydrate("1017");

    expect(await requestsTo("id.twitch.tv")).toHaveLength(1);
    expect(await requestsTo("api.igdb.com")).toHaveLength(2);
  });

  it("authenticates every query with the token and the client id", async () => {
    await igdb.igdbProvider.search("chrono trigger");

    const [query] = await requestsTo("api.igdb.com");
    expect(query.headers.get("Authorization")).toBe(`Bearer ${TWITCH_APP_TOKEN}`);
    expect(query.headers.get("Client-ID")).toBe(FAKE_IGDB_CLIENT_ID);
  });

  it("asks Twitch for a client_credentials grant", async () => {
    await igdb.igdbProvider.search("chrono trigger");

    const [token] = await requestsTo("id.twitch.tv");
    expect(token.method).toBe("POST");
    expect(Object.fromEntries(token.url.searchParams)).toEqual({
      client_id: FAKE_IGDB_CLIENT_ID,
      client_secret: FAKE_IGDB_CLIENT_SECRET,
      grant_type: "client_credentials",
    });
  });

  it("surfaces a rejected token request", async () => {
    server.use(http.post(TWITCH_TOKEN_URL, () => new HttpResponse(null, { status: 403 })));

    await expect(igdb.igdbProvider.search("chrono trigger")).rejects.toThrow(
      "Twitch token request failed: 403",
    );
  });

  it("surfaces a failed query with its status", async () => {
    server.use(http.post(IGDB_GAMES_URL, () => new HttpResponse(null, { status: 500 })));

    await expect(igdb.igdbProvider.search("chrono trigger")).rejects.toThrow("IGDB games failed: 500");
  });
});

describe("isIgdbConfigured", () => {
  it("needs both halves of the credential", async () => {
    expect(igdb.isIgdbConfigured()).toBe(true);

    vi.stubEnv("IGDB_CLIENT_SECRET", "");
    expect(igdb.isIgdbConfigured()).toBe(false);

    vi.stubEnv("IGDB_CLIENT_SECRET", FAKE_IGDB_CLIENT_SECRET);
    vi.stubEnv("IGDB_CLIENT_ID", undefined);
    expect(igdb.isIgdbConfigured()).toBe(false);
  });

  it("makes a query throw before it reaches the network", async () => {
    // Rather than after a 401, which is what an unconfigured instance would
    // otherwise spend a request finding out.
    vi.stubEnv("IGDB_CLIENT_ID", undefined);

    await expect(igdb.igdbProvider.search("chrono trigger")).rejects.toThrow(/IGDB is not configured/);
    expect(await recordedRequests()).toEqual([]);
  });
});
