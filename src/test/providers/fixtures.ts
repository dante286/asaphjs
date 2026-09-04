import type { IgdbGame } from "@/lib/metadata/providers/igdb";
import type { TmdbDetail, TmdbSearchResult } from "@/lib/metadata/providers/tmdb";
import type { OpenLibraryDoc, OpenLibraryWork } from "@/lib/metadata/providers/openlibrary";

/**
 * Hand-authored payloads, not recorded traffic — which is what lets this tier
 * run with no credentials at all. Each is `satisfies` its provider's own
 * declared response type, so widening or renaming a field in the provider
 * breaks the fixture at typecheck rather than letting it drift into fiction.
 *
 * These are the happy path the default handlers serve. A spec testing one
 * specific quirk overrides them with `server.use(...)` inline, next to the
 * assertion about it, rather than growing a catalogue nobody can map back to a
 * test.
 */

// --- IGDB -------------------------------------------------------------------

export const IGDB_CHRONO_TRIGGER_ID = 1017;

/**
 * `first_release_date` is Unix **seconds** (1995-03-11), the cover comes back as
 * a protocol-relative `t_thumb` URL whatever size was asked for, and neither
 * involved company is the one a naive `companies[0]` would pick: the publisher
 * is second in the array and the developer is first.
 */
export const IGDB_CHRONO_TRIGGER = {
  id: IGDB_CHRONO_TRIGGER_ID,
  name: "Chrono Trigger",
  summary: "A band of adventurers travels through time to prevent a global catastrophe.",
  url: "https://www.igdb.com/games/chrono-trigger",
  first_release_date: 794_880_000,
  cover: { url: "//images.igdb.com/igdb/image/upload/t_thumb/co2i5f.jpg" },
  platforms: [
    { name: "Super Nintendo Entertainment System", abbreviation: "SNES" },
    { name: "Nintendo DS", abbreviation: "NDS" },
    { name: "PC (Microsoft Windows)", abbreviation: "PC" },
    { name: "Android", abbreviation: "Android" },
    { name: "iOS", abbreviation: "iOS" }, // a fifth, so the picker's cap is visible
  ],
  genres: [{ name: "Role-playing (RPG)" }, { name: "Adventure" }],
  franchises: [{ name: "Chrono" }],
  collections: [{ name: "Chrono Trigger Collection" }],
  involved_companies: [
    { company: { name: "Square" }, publisher: false, developer: true },
    { company: { name: "Square Soft, Inc." }, publisher: true, developer: false },
  ],
} satisfies IgdbGame;

/** Every field IGDB may omit, omitted — the shape a sparsely indexed game comes back as. */
export const IGDB_SPARSE_GAME = { id: 138_299, name: "Chrono Trigger: Prophet's Guile" } satisfies IgdbGame;

/** IGDB indexes rows with no name; `search` puts them in the results anyway. */
export const IGDB_NAMELESS_GAME = { id: 205_888 } satisfies IgdbGame;

export const IGDB_SEARCH_DOCS = [
  IGDB_CHRONO_TRIGGER,
  IGDB_NAMELESS_GAME,
  IGDB_SPARSE_GAME,
] satisfies IgdbGame[];

export const IGDB_CATALOGUE: Record<number, IgdbGame> = {
  [IGDB_CHRONO_TRIGGER_ID]: IGDB_CHRONO_TRIGGER,
};

// --- TMDB -------------------------------------------------------------------

/**
 * `search/multi` returns three media types and TMDB's own placeholder shapes:
 * a `person` row that has nothing to do with a shelf, a row with neither
 * `title` nor `name`, and `release_date: ""` for something unscheduled.
 */
export const TMDB_SEARCH_MULTI = [
  {
    id: 603,
    media_type: "movie",
    title: "The Matrix",
    release_date: "1999-03-31",
    poster_path: "/p96dm7sCMn4VYAStA6siNz30G1r.jpg",
  },
  {
    id: 1396,
    media_type: "tv",
    name: "Breaking Bad",
    first_air_date: "2008-01-20",
    poster_path: "/ggFHVNu6YYI5L9pCfOacjizRGt.jpg",
  },
  { id: 6384, media_type: "person", name: "Keanu Reeves", poster_path: "/6RgHzHb2xPCLoS6JAcnKtfrbHKk.jpg" },
  { id: 9999, media_type: "movie", release_date: "1999-01-01" },
  { id: 1_244_944, media_type: "movie", title: "Untitled Matrix Film", release_date: "", poster_path: null },
] satisfies TmdbSearchResult[];

export const TMDB_MATRIX = {
  title: "The Matrix",
  overview: "  Set in the 22nd century, The Matrix tells the story of a computer hacker.  ",
  release_date: "1999-03-31",
  poster_path: "/p96dm7sCMn4VYAStA6siNz30G1r.jpg",
  genres: [{ name: "Action" }, { name: "Science Fiction" }],
  belongs_to_collection: { name: "The Matrix Collection" },
} satisfies TmdbDetail;

/** TV carries `name`/`first_air_date` and has no `belongs_to_collection` at all. */
export const TMDB_BREAKING_BAD = {
  name: "Breaking Bad",
  overview: "A high school chemistry teacher diagnosed with inoperable lung cancer.",
  first_air_date: "2008-01-20",
  poster_path: "/ggFHVNu6YYI5L9pCfOacjizRGt.jpg",
  genres: [{ name: "Drama" }, { name: "Crime" }],
} satisfies TmdbDetail;

export const TMDB_MOVIE_CATALOGUE: Record<number, TmdbDetail> = { 603: TMDB_MATRIX };
export const TMDB_TV_CATALOGUE: Record<number, TmdbDetail> = { 1396: TMDB_BREAKING_BAD };

// --- Open Library -----------------------------------------------------------

export const OL_WORK_KEY = "/works/OL21177745W";
export const OL_SERIES_KEY = "/series/OL326107L";
export const OL_AUTHOR_KEY = "/authors/OL8480745A";
export const OL_COAUTHOR_KEY = "/authors/OL9024561A";

/**
 * `covers` leads with the -1 placeholder Open Library uses for a work whose art
 * it doesn't have on the work record, `subjects` mixes real genres with machine
 * tags and a catalogue phrase, `description` is the object form, and both the
 * author and the series are keys rather than names.
 */
export const OL_WORK = {
  title: "Frieren: Beyond Journey's End, Vol. 1",
  covers: [-1, 12_547_191],
  subjects: [
    "form:manga",
    "Fantasy fiction",
    "nyt:graphic-books-and-manga=2021-04-11",
    "Comic books, strips, etc",
    "Fantasy comic books, strips, etc. Japanese Translations into English",
    "Adventure",
    "Elves",
  ],
  description: { value: "  Frieren the elf mage outlives the party she saved the world with.  " },
  authors: [{ author: { key: OL_AUTHOR_KEY } }, { author: { key: OL_COAUTHOR_KEY } }],
  series: [{ series: { key: OL_SERIES_KEY } }],
} satisfies OpenLibraryWork;

/** The search index has the cover the work record is missing, plus the author names. */
export const OL_WORK_DOC = {
  key: OL_WORK_KEY,
  title: "Frieren: Beyond Journey's End, Vol. 1",
  first_publish_year: 2021,
  author_name: ["Kanehito Yamada", "Tsukasa Abe"],
  cover_i: 12_547_191,
  publisher: ["VIZ Media LLC", "VIZ Media LLC"], // one publisher, once per edition
  subject: ["Manga"],
} satisfies OpenLibraryDoc;

export const OL_SERIES = { name: "Frieren: Beyond Journey's End" };
export const OL_AUTHOR = { name: "Kanehito Yamada" };
export const OL_COAUTHOR = { name: "Tsukasa Abe" };

/** search.json returns docs with no title, and docs with no cover or author indexed. */
export const OL_SEARCH_DOCS = [
  OL_WORK_DOC,
  { key: "/works/OL21177746W", first_publish_year: 2021 },
  { key: "/works/OL21177747W", title: "Frieren: Beyond Journey's End, Vol. 2" },
] satisfies OpenLibraryDoc[];

export const OL_WORK_CATALOGUE: Record<string, OpenLibraryWork> = { [OL_WORK_KEY]: OL_WORK };
export const OL_DOC_CATALOGUE: Record<string, OpenLibraryDoc> = { [OL_WORK_KEY]: OL_WORK_DOC };
export const OL_AUTHOR_CATALOGUE: Record<string, { name?: string }> = {
  [OL_AUTHOR_KEY]: OL_AUTHOR,
  [OL_COAUTHOR_KEY]: OL_COAUTHOR,
};
export const OL_SERIES_CATALOGUE: Record<string, { name?: string }> = { [OL_SERIES_KEY]: OL_SERIES };
