import { http, HttpResponse } from "msw";
import {
  IGDB_CATALOGUE,
  IGDB_SEARCH_DOCS,
  OL_AUTHOR_CATALOGUE,
  OL_DOC_CATALOGUE,
  OL_SEARCH_DOCS,
  OL_SERIES_CATALOGUE,
  OL_WORK_CATALOGUE,
  TMDB_MOVIE_CATALOGUE,
  TMDB_SEARCH_MULTI,
  TMDB_TV_CATALOGUE,
} from "./fixtures";

/**
 * The hosts the providers reach. Exported so a spec's own override names the
 * same string this file does — a typo in a `server.use` URL would otherwise
 * leave the request unhandled, and `onUnhandledRequest: "error"` reports that
 * as a network escape rather than as the typo it is.
 */
export const TWITCH_TOKEN_URL = "https://id.twitch.tv/oauth2/token";
export const IGDB_GAMES_URL = "https://api.igdb.com/v4/games";
export const TMDB_BASE_URL = "https://api.themoviedb.org/3";
export const OPENLIBRARY_BASE_URL = "https://openlibrary.org";

export const TWITCH_APP_TOKEN = "fake-twitch-app-access-token";

/** Open Library names things by key, and asks for them by that key plus `.json`. */
function keyFrom(prefix: string, param: string | readonly string[] | undefined): string {
  return `${prefix}/${String(param).replace(/\.json$/, "")}`;
}

const notFound = () => new HttpResponse(null, { status: 404 });

/**
 * The happy path, and nothing else. A spec exercising a quirk — a missing
 * publisher flag, an unscheduled release, a 500 — prepends its own handler with
 * `server.use(...)`, so the payload that makes the test interesting sits next to
 * the assertion about it instead of in a shared fixture file.
 */
export const handlers = [
  // --- IGDB ---------------------------------------------------------------
  http.post(TWITCH_TOKEN_URL, () =>
    // 60 days, which is what Twitch actually returns for a client-credentials
    // grant — long enough that the provider's own expiry check never trips.
    HttpResponse.json({ access_token: TWITCH_APP_TOKEN, expires_in: 5_184_000 }),
  ),

  /**
   * One endpoint serves both calls: IGDB takes an APICalypse query as a plain
   * text body, so which call this is has to be read out of that body. `where id
   * = N` is a hydrate; anything else is a search.
   */
  http.post(IGDB_GAMES_URL, async ({ request }) => {
    const body = await request.text();
    const id = /where id = (\d+)/.exec(body)?.[1];
    if (id === undefined) return HttpResponse.json(IGDB_SEARCH_DOCS);

    const game = IGDB_CATALOGUE[Number(id)];
    // An unknown id is an empty array, not a 404 — IGDB answers 200 with no rows.
    return HttpResponse.json(game ? [game] : []);
  }),

  // --- TMDB ---------------------------------------------------------------
  http.get(`${TMDB_BASE_URL}/search/multi`, () => HttpResponse.json({ results: TMDB_SEARCH_MULTI })),

  http.get(`${TMDB_BASE_URL}/movie/:id`, ({ params }) => {
    const detail = TMDB_MOVIE_CATALOGUE[Number(params.id)];
    return detail ? HttpResponse.json(detail) : notFound();
  }),

  http.get(`${TMDB_BASE_URL}/tv/:id`, ({ params }) => {
    const detail = TMDB_TV_CATALOGUE[Number(params.id)];
    return detail ? HttpResponse.json(detail) : notFound();
  }),

  // --- Open Library -------------------------------------------------------
  /**
   * search.json answers two different questions: a person's query, and
   * hydrate's own `q=key:/works/...` lookup of the doc behind one work.
   */
  http.get(`${OPENLIBRARY_BASE_URL}/search.json`, ({ request }) => {
    const q = new URL(request.url).searchParams.get("q") ?? "";
    if (!q.startsWith("key:")) return HttpResponse.json({ docs: OL_SEARCH_DOCS });

    const doc = OL_DOC_CATALOGUE[q.slice("key:".length)];
    return HttpResponse.json({ docs: doc ? [doc] : [] });
  }),

  http.get(`${OPENLIBRARY_BASE_URL}/works/:work`, ({ params }) => {
    const work = OL_WORK_CATALOGUE[keyFrom("/works", params.work)];
    return work ? HttpResponse.json(work) : notFound();
  }),

  http.get(`${OPENLIBRARY_BASE_URL}/authors/:author`, ({ params }) => {
    const author = OL_AUTHOR_CATALOGUE[keyFrom("/authors", params.author)];
    return author ? HttpResponse.json(author) : notFound();
  }),

  http.get(`${OPENLIBRARY_BASE_URL}/series/:series`, ({ params }) => {
    const series = OL_SERIES_CATALOGUE[keyFrom("/series", params.series)];
    return series ? HttpResponse.json(series) : notFound();
  }),
];
