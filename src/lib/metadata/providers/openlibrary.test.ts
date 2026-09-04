import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { FAKE_USER_AGENT } from "@/test/providers/credentials";
import {
  OL_AUTHOR_KEY,
  OL_SERIES_KEY,
  OL_WORK,
  OL_WORK_DOC,
  OL_WORK_KEY,
} from "@/test/providers/fixtures";
import { OPENLIBRARY_BASE_URL } from "@/test/providers/handlers";
import { recordedRequests, requestsTo } from "@/test/providers/requests";
import { server } from "@/test/providers/server";
import type { OpenLibraryDoc, OpenLibraryWork } from "./openlibrary";
import { openLibraryProvider } from "./openlibrary";

/**
 * Open Library is the keyless provider, so these specs would run against the
 * real service — which is exactly why they must not. The fixtures hold the
 * shapes that made `hydrate` what it is: a `covers` array led by the -1
 * placeholder, `subjects` mixing genres with machine tags, and an author and a
 * series named only by key.
 *
 * The request count is part of the contract here. `hydrate` reads a work, its
 * search doc, and then only what's still missing — a version that resolved
 * author records it didn't need would return identical fields and quietly cost
 * two more requests against a limiter of one per second.
 */

function olSearch(...docs: OpenLibraryDoc[]) {
  return http.get(`${OPENLIBRARY_BASE_URL}/search.json`, () => HttpResponse.json({ docs }));
}

function olWork(work: OpenLibraryWork) {
  return http.get(`${OPENLIBRARY_BASE_URL}/works/:work`, () => HttpResponse.json(work));
}

async function olRequests() {
  return requestsTo("openlibrary.org");
}

describe("openLibraryProvider.search", () => {
  it("maps a doc onto a candidate", async () => {
    const [candidate] = await openLibraryProvider.search("frieren");

    expect(candidate).toEqual({
      sourceId: OL_WORK_KEY, // the work key, which is what hydrate takes
      title: "Frieren: Beyond Journey's End, Vol. 1",
      year: 2021,
      // Two names joined: manga credit story and art separately and both
      // belong in an Author field.
      subtitle: "Kanehito Yamada, Tsukasa Abe",
      coverUrl: "https://covers.openlibrary.org/b/id/12547191-L.jpg",
    });
  });

  it("drops a doc with no title and keeps a thinly indexed one", async () => {
    const candidates = await openLibraryProvider.search("frieren");

    expect(candidates.map((c) => c.sourceId)).toEqual([OL_WORK_KEY, "/works/OL21177747W"]);
    // A doc with no cover, no year and no author still names something a person
    // can recognize and pick.
    expect(candidates.at(-1)).toEqual({
      sourceId: "/works/OL21177747W",
      title: "Frieren: Beyond Journey's End, Vol. 2",
      year: undefined,
      subtitle: undefined,
      coverUrl: undefined,
    });
  });

  it("asks for an explicit field list", async () => {
    await openLibraryProvider.search("frieren");

    // Without one, search.json returns every indexed field for every doc —
    // hundreds of KB for ten results, nearly all of it unused.
    const [request] = await olRequests();
    expect(Object.fromEntries(request.url.searchParams)).toEqual({
      q: "frieren",
      fields: "key,title,author_name,first_publish_year,cover_i,publisher,subject",
      limit: "10",
    });
  });

  it("identifies itself, because Open Library asks callers to", async () => {
    await openLibraryProvider.search("frieren");

    expect((await olRequests())[0].headers.get("User-Agent")).toBe(FAKE_USER_AGENT);
  });

  it("falls back to a User-Agent that says what to set", async () => {
    // Read once at module evaluation, so this needs a freshly imported module
    // rather than a stubbed variable.
    vi.stubEnv("METADATA_USER_AGENT", undefined);
    vi.resetModules();
    const unconfigured = await import("./openlibrary");

    await unconfigured.openLibraryProvider.search("frieren");

    expect((await olRequests())[0].headers.get("User-Agent")).toBe("AsaphJS/0.1 (set METADATA_USER_AGENT)");
  });

  it("surfaces a failed search with its status", async () => {
    server.use(http.get(`${OPENLIBRARY_BASE_URL}/search.json`, () => new HttpResponse(null, { status: 502 })));

    await expect(openLibraryProvider.search("frieren")).rejects.toThrow(/OpenLibrary \/search\.json.* failed: 502/);
  });
});

describe("openLibraryProvider.hydrate", () => {
  it("maps a work and its search doc onto canonical fields", async () => {
    const fields = await openLibraryProvider.hydrate(OL_WORK_KEY);

    expect(fields).toEqual({
      title: "Frieren: Beyond Journey's End, Vol. 1",
      author: "Kanehito Yamada, Tsukasa Abe",
      // One imprint listed once per edition, so the list is unambiguous.
      publisher: "VIZ Media LLC",
      // "form:manga" and "nyt:...=2021-04-11" are machine tags, the
      // translations line is a catalogue phrase no one calls a genre, and the
      // cap is three — so of seven subjects these are what's left.
      genre: ["Fantasy fiction", "Comic books, strips, etc", "Adventure"],
      series: "Frieren: Beyond Journey's End",
      year: 2021,
      summary: "Frieren the elf mage outlives the party she saved the world with.",
      // The work's own covers array leads with -1; this is the second entry,
      // not the placeholder and not the doc's copy.
      coverUrl: "https://covers.openlibrary.org/b/id/12547191-L.jpg",
      sourceUrl: "https://openlibrary.org/works/OL21177745W",
    });
  });

  it("resolves the author records only when the search index has no doc for the work", async () => {
    await openLibraryProvider.hydrate(OL_WORK_KEY);

    // The work, its search doc, and the series name — and nothing else. The
    // author names were already on the doc.
    expect((await olRequests()).map((r) => r.url.pathname)).toEqual([
      "/works/OL21177745W.json",
      "/search.json",
      "/series/OL326107L.json",
    ]);
  });

  it("names the authors from their own records when there is no doc", async () => {
    // A work the search index hasn't picked up: the names live on the author
    // records, which are two more requests and only worth making here.
    server.use(olSearch());

    const fields = await openLibraryProvider.hydrate(OL_WORK_KEY);

    expect(fields.author).toBe("Kanehito Yamada, Tsukasa Abe");
    expect((await olRequests()).filter((r) => r.url.pathname.startsWith("/authors/"))).toHaveLength(2);
  });

  it("takes the cover from the search index when the work record only has a placeholder", async () => {
    // This is the whole reason hydrate reads the doc as well as the work: a
    // lookup used to show a cover in the picker and then apply none.
    server.use(olWork({ ...OL_WORK, covers: [-1] }));

    expect((await openLibraryProvider.hydrate(OL_WORK_KEY)).coverUrl).toBe(
      "https://covers.openlibrary.org/b/id/12547191-L.jpg",
    );
  });

  it("leaves the cover absent when neither the work nor the index has one", async () => {
    server.use(olWork({ ...OL_WORK, covers: [-1] }), olSearch({ ...OL_WORK_DOC, cover_i: undefined }));

    expect((await openLibraryProvider.hydrate(OL_WORK_KEY)).coverUrl).toBeUndefined();
  });

  it("leaves the publisher absent when the editions disagree", async () => {
    // `publisher` is every edition's publisher in one unordered list — Eragon
    // has 56 across a dozen languages, and the first is as likely to be a Dutch
    // imprint as the one on the shelf.
    server.use(olSearch({ ...OL_WORK_DOC, publisher: ["VIZ Media LLC", "Carlsen Manga", "Kadokawa"] }));

    expect((await openLibraryProvider.hydrate(OL_WORK_KEY)).publisher).toBeUndefined();
  });

  it("counts one imprint written two ways as one publisher", async () => {
    // Case and spacing vary edition to edition, and a list that differs only
    // in those is still an unambiguous answer — the last spelling seen wins.
    server.use(olSearch({ ...OL_WORK_DOC, publisher: ["VIZ Media LLC", " viz media llc "] }));

    expect((await openLibraryProvider.hydrate(OL_WORK_KEY)).publisher).toBe("viz media llc");
  });

  it("ignores the blank entries the index leaves in its lists", async () => {
    // A blank author would otherwise be joined as a leading ", " and a blank
    // publisher would count as a second distinct one, hiding the real answer.
    server.use(
      olSearch({
        ...OL_WORK_DOC,
        author_name: ["", "Kanehito Yamada"],
        publisher: ["  ", "VIZ Media LLC"],
      }),
    );

    const fields = await openLibraryProvider.hydrate(OL_WORK_KEY);

    expect(fields.author).toBe("Kanehito Yamada");
    expect(fields.publisher).toBe("VIZ Media LLC");
  });

  it("falls back to the doc's subjects when the work carries none", async () => {
    server.use(olWork({ ...OL_WORK, subjects: undefined }));

    expect((await openLibraryProvider.hydrate(OL_WORK_KEY)).genre).toEqual(["Manga"]);
  });

  it("keeps one subject per spelling", async () => {
    server.use(olWork({ ...OL_WORK, subjects: ["Fantasy", "fantasy", "FANTASY", "Elves"] }));

    // Deduped case-insensitively, so the cap of three isn't spent on one genre
    // written three ways. The last spelling seen is the one kept.
    expect((await openLibraryProvider.hydrate(OL_WORK_KEY)).genre).toEqual(["FANTASY", "Elves"]);
  });

  it("reads a description given as a bare string", async () => {
    // Open Library returns both shapes depending on the record's age.
    server.use(olWork({ ...OL_WORK, description: "  An elf mage outlives her party.  " }));

    expect((await openLibraryProvider.hydrate(OL_WORK_KEY)).summary).toBe("An elf mage outlives her party.");
  });

  it("takes a series given as a plain string without a further request", async () => {
    server.use(olWork({ ...OL_WORK, series: ["Frieren  "] }));

    expect((await openLibraryProvider.hydrate(OL_WORK_KEY)).series).toBe("Frieren");
    expect((await olRequests()).some((r) => r.url.pathname.startsWith("/series/"))).toBe(false);
  });

  it("leaves the series absent when its record is gone", async () => {
    server.use(http.get(`${OPENLIBRARY_BASE_URL}/series/:series`, () => new HttpResponse(null, { status: 404 })));

    expect((await openLibraryProvider.hydrate(OL_WORK_KEY)).series).toBeUndefined();
  });

  it("leaves the series absent when the work has none", async () => {
    server.use(olWork({ ...OL_WORK, series: undefined }));

    expect((await openLibraryProvider.hydrate(OL_WORK_KEY)).series).toBeUndefined();
  });

  it("fills what a bare work record allows and invents nothing", async () => {
    // Open Library's records are contributor-maintained and routinely this
    // thin, with nothing in the search index either.
    server.use(olWork({}), olSearch());

    expect(await openLibraryProvider.hydrate(OL_WORK_KEY)).toEqual({
      title: undefined,
      author: undefined,
      publisher: undefined,
      genre: [],
      series: undefined,
      year: undefined,
      summary: undefined,
      coverUrl: undefined,
      sourceUrl: "https://openlibrary.org/works/OL21177745W",
    });
  });

  it("ignores a series named only by whitespace", async () => {
    server.use(olWork({ ...OL_WORK, series: ["   "] }));

    expect((await openLibraryProvider.hydrate(OL_WORK_KEY)).series).toBeUndefined();
  });

  it("survives a search response with no docs key at all", async () => {
    server.use(http.get(`${OPENLIBRARY_BASE_URL}/search.json`, () => HttpResponse.json({})));

    expect(await openLibraryProvider.search("frieren")).toEqual([]);
  });

  it.each(["OL21177745W", "/authors/OL8480745A", "/works", ""])(
    "rejects the work key %j before asking Open Library",
    async (sourceId) => {
      await expect(openLibraryProvider.hydrate(sourceId)).rejects.toThrow(/Invalid Open Library work key/);
      expect(await recordedRequests()).toEqual([]);
    },
  );

  it("throws when the work is gone", async () => {
    await expect(openLibraryProvider.hydrate("/works/OL0W")).rejects.toThrow(
      "Open Library work /works/OL0W not found",
    );
  });
});

describe("the requests hydrate makes", () => {
  it("names the author and series keys it was given", async () => {
    await openLibraryProvider.hydrate(OL_WORK_KEY);
    const paths = (await olRequests()).map((r) => r.url.pathname);

    // Works reference both by key, so the names are one more fetch each — and
    // the keys have to be the work's own, not guessed from the title.
    expect(paths).toContain(`${OL_SERIES_KEY}.json`);
    expect(paths).not.toContain(`${OL_AUTHOR_KEY}.json`);
  });

  it("looks the doc up by key rather than by title", async () => {
    await openLibraryProvider.hydrate(OL_WORK_KEY);

    const search = (await olRequests()).find((r) => r.url.pathname === "/search.json");
    expect(search?.url.searchParams.get("q")).toBe(`key:${OL_WORK_KEY}`);
    expect(search?.url.searchParams.get("limit")).toBe("1");
  });
});
