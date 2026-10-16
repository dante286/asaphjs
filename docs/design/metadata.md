# Metadata lookups

The item detail page's Metadata panel searches the collection's provider, lists the
candidates, and writes the picked one's fields into the item. Which provider a collection
uses comes from `features.lookup`, falling back to a per-template default in
`src/lib/metadata/lookup-config.ts` (`video_games` → IGDB, `books`/`comics`/`manga`/
`strategy_guides` → Open Library, `movies`/`tv_shows`/`anime` → TMDB). A template with no
default, or a provider whose keys are missing, renders no panel at all rather than a button
that fails.

The three TMDB templates carry a Release Date (First Aired on TV Shows), Synopsis and Genre
field precisely so a match has somewhere to put `releaseDate`, `summary` and `genre` —
Comments is the owner's own notes (it maps to `items.notes`) and no lookup ever writes it.
There's deliberately no Year column: the date already carries the year, and two fields
holding one fact would both fill and then disagree the first time someone edited either.

What lands where is deliberately conservative, because a wrong autofill is worse than a
blank field:

- Providers return **canonical keys** (`publisher`, `platforms`, `series`, `genre`, …) and
  `src/lib/metadata/prefill.ts` maps those onto whatever field ids the collection actually
  has. Unmapped fields — every checkbox on Video Games included — are never touched: IGDB
  can't know whether *your* copy still has the booklet insert.
- Applying a match **fills blanks only**. Your own corrections survive it. "Overwrite
  fields that already have a value" and "Re-run lookup" are the explicit opt-ins.
- A select only accepts one of its own options, and a multi-platform release won't guess at
  a free-text Console field — "Satellaview · SNES · Wii" is not an answer to which console
  your copy is for.
- `items.external_ref` records the match (source + id + timestamp) and is written only by
  the actions in `src/actions/metadata.ts`; the items PATCH route strips it off client
  bodies so nobody can claim a match that never happened.

## Provider quirks worth knowing

- **IGDB** indexes far more than boxed releases, and unfiltered `search` ranks them
  ahead of it — "chrono trigger" puts three Satellaview add-ons above the 1995 SNES
  cartridge. Searches filter to main games, remakes, remasters, ports and expanded
  editions, and show platform and year so you can tell the releases apart.
- IGDB is also the only provider whose id lands in a query *body* rather than a URL path:
  APICalypse reads `where id = 1017;` as text, so a `;` in a source id would end the clause
  and ask a different question. A hydrate id is matched against `/^\d+$/` before it gets
  that far, which rejects a blank id in the same stroke — that one used to parse as 0 and
  spend a query on a game IGDB has never had (#50).
- **Open Library** work records name their authors and series *by key*
  (`/authors/OL1425963A`), not by value, and a work's `covers` array can be empty for a
  work the search index does have art for. So a hydrate reads the work, its search-index
  doc and its series record together — that's why matching Eragon now fills "Christopher
  Paolini" and "The Inheritance Cycle" and lands the same cover the picker showed.
- Open Library's `publisher` is every edition's publisher in one unordered list (Eragon
  has 56 across a dozen languages), so it only fills the field when the list is
  unambiguous. Subjects get filtered too — `nyt:graphic-books-and-manga=2021-04-11` and
  `form:manga` are machine tags, not genres.
- **TMDB** covers all three templates it's wired to off one `search/multi` call, because the
  Anime template holds films and series side by side — a source id is `movie:603` or
  `tv:1396` so a hydrate knows which endpoint to read. The id half is matched as digits
  rather than parsed, so a malformed one is rejected before the request instead of costing
  a call against the free tier to come back a 404. TV hits are labelled "TV" in the
  picker, which together with the year is what tells "cowboy bebop"'s three top hits apart —
  the 1998 series, the 2021 live-action one, and the 2001 film. Only movies group into
  franchises (`belongs_to_collection`); TMDB has no TV equivalent, so Series stays blank on
  TV Shows and on an anime *series*, while an anime *film* fills it — that asymmetry is
  TMDB's, not a bug, and fills-blanks-only means a franchise you type yourself is never
  clobbered. Episode- and season-level data is out of scope here (Seasons, Completed and
  Watched are owner facts about the boxset) — that's what would argue for AniList/MAL later.
- TMDB genres movies and TV against different vocabularies, so a Genre field can end up
  holding both dialects — Dune is "Science Fiction"/"Adventure", Cowboy Bebop is
  "Sci-Fi & Fantasy"/"Action & Adventure". They're TMDB's own labels, left as-is rather than
  mapped onto a house list that would go stale.
- TMDB issues two credentials for the same v3 API — a 32-char key that authenticates on an
  `api_key` query param and a Read Access Token that goes in an `Authorization` header — and
  the settings page shows them side by side. `TMDB_API_KEY` takes either and picks the
  scheme by shape, because guessing wrong is an opaque 401. The key ends up in the URL on
  the v3 path, so failures log the request *path*, never the built URL.

## Cover art is copied, not hotlinked

Applying a match pulls the provider's cover through the same sharp pipeline as an uploaded
photo (`src/lib/metadata/cover-mirror.ts` → `saveUpload`), so the item ends up with a local
`/api/uploads/…` URL and a grid thumbnail.

`mirrorCover` only fetches from an allowlist of provider image hosts, so adding a provider
means adding its host — a missing one fails the check silently and the item keeps the
provider's URL, which still renders. The only way to catch it is to look at what got stored.

Items matched before their host was on that list stay hotlinked, and re-running the lookup
won't heal them: `buildPrefillPlan` only patches `coverUrl` when the hydrated URL differs
from the stored one, and for those it's the same string, so `mirrorCover` is never reached.
`npm run covers:backfill` walks items whose cover isn't local yet and mirrors what it can.
It's a dry run unless passed `--apply`, narrows with `--collection=<slug>`, `--host=<host>`
and `--limit=<n>`, and is safe to rerun — anything already local is skipped, and a failed
fetch leaves the item alone so the next run retries it. It writes `cover_url` only, leaving
`updated_at` alone: where the bytes live isn't an edit to the item, and bumping it would
push every backfilled row to the top of "recently updated".

Hotlinking looked fine and wasn't: Open Library redirects `covers.openlibrary.org` to
archive.org, which extracts the JPEG from a zip on demand — measured at ~8s to first paint.
The lookup would report that it filled the cover while the frame stayed empty, and a covers
grid paid that per tile. Mirroring pays it once, at match time. If the fetch fails the item
keeps the provider's URL, so a match never fails over a slow image.

## Staying inside the free tier

IGDB allows 4 requests/second on a free Twitch app, so the cache is the feature, not an
optimization:

- `metadata_cache` (by source id) and `metadata_search_cache` (by normalized query) are
  read before any HTTP call. Hydrates never expire — box art and publisher don't change
  once something ships — and searches expire after 30 days so a query that matched nothing
  isn't wrong forever. Empty results are cached too, which is what stops an unmatched title
  from being re-queried on every visit.
- Concurrent identical calls collapse onto one upstream request (`cached-provider.ts`), and
  a fixed-window limiter caps outbound rate per provider (`rate-limiter.ts`) across every
  caller in the process.
- Because hydrates never expire, each cached payload carries the schema version it was
  written under. Bump `PAYLOAD_SCHEMA_VERSION` when a provider changes which canonical keys
  it returns and stale rows refetch on next use — otherwise a book cached before Open
  Library learned to return authors would stay authorless until someone re-ran it by hand.
- Searches only ever run on an explicit click — never as-you-type — and the query field is
  pre-filled with the item's title, so the common case is one request per item, ever.

Two things check this, and the difference between them is the point.

`src/lib/metadata/cached-provider.db.test.ts` runs on every pull request. It counts the
requests that actually leave the process — through the real registry, the real provider
code and real rows, with MSW answering the HTTP and Postgres holding the cache — and
asserts each claim above in requests spent: cold search 1, warm 0, five concurrent
identical searches 1, cold hydrate exactly what that provider's records cost (three for
Open Library, one for IGDB), warm 0, `forceRefresh` spends again, a row a minute short of
the 30-day TTL is served and a minute past it is refetched, an empty result is cached, and
a row stamped with an older schema version refetches *and is written back*. A cache hit
and a cache miss return identical fields, so the request count is the only thing that can
tell them apart.

`npm run lookup:check` does the same seven checks against the real provider, with real
credentials, and prints them for a human. It is not redundant: those MSW fixtures are ours,
written against types we declared, so by construction they cannot notice TMDB changing a
field name. The spec guards against our regressions; the script guards against a provider's,
and it is the thing to reach for when a lookup starts misbehaving on a real instance. It
purges only the rows for the query it tests, and takes a provider and query:
`npm run lookup:check -- tmdb "dune"`.

## Not built yet

MusicBrainz and Rebrickable providers. The interface and registry in `src/lib/metadata` take
them as-is; each just needs keys and a `search`/`hydrate` pair.
