# Asaph

A collection tracker (games, books, manga, movies, vinyl, bricks — anything) built on one
generic schema instead of a table per hobby. Replaces a 13-table Oracle APEX app; see
`ARCHITECTURE.md`-derived design in the code (schema, per-field autosave, CSV import,
sharing) if you want the full rationale.

## Stack

- **Next.js 16** (App Router, TypeScript) — route handlers under `src/app/api/**` are the API layer.
- **PostgreSQL** via **Drizzle ORM** (`src/db`). MySQL isn't wired up, but the schema/client
  layer is isolated enough to swap later — see the note at the bottom of this file.
- **Better Auth** for email/password auth, sessions stored in Postgres.
- **TanStack Query** for the item grid's optimistic per-field autosave; everything else is
  Server Components + Server Actions.
- The "Industry" design system (blueprint/hairline-corner motif) is vendored verbatim in
  `src/app/design-system.css`.

## Setup (first-time run)

Requires Node 20.9+ (the floor Next.js 16 enforces) and Docker. The container image builds
on `node:24-alpine`, so 24 is the version to match if you want local dev and Docker aligned.

1. **Install:**

   ```bash
   npm install
   ```

2. **Env vars.** Copy `.env.example` to `.env.local` and generate a `BETTER_AUTH_SECRET`
   (`openssl rand -base64 32`). Defaults for `DATABASE_URL` already match step 3 below, so
   nothing else needs to change for local dev. The metadata provider keys are optional —
   without them those collections just show no metadata panel: `IGDB_CLIENT_ID`/
   `IGDB_CLIENT_SECRET` (register an app at
   [dev.twitch.tv/console](https://dev.twitch.tv/console)) for games, and `TMDB_API_KEY`
   for movies and anime — either credential from
   [themoviedb.org/settings/api](https://www.themoviedb.org/settings/api) works, the
   32-char "API Key" or the longer "API Read Access Token".

3. **Database.** Any Postgres 14+ works; Postgres 18 is the tested/recommended version.
   Easiest is the `db` service already defined in `docker-compose.yml`:

   ```bash
   docker compose up -d db
   ```

   (Standalone `docker run` also works — see the `db` service definition for the
   equivalent flags. Postgres 18+ images expect their volume mounted at
   `/var/lib/postgresql`, not the older `/var/lib/postgresql/data`.)

4. **Migrate + seed.** `db:migrate` creates the schema; `db:seed` inserts the 15 built-in
   templates (14 collection types plus "Blank"):

   ```bash
   npm run db:migrate
   npm run db:seed
   ```

   Both read `DATABASE_URL` from `.env.local` — not `.env`, which Compose reads separately.
   A `DATABASE_URL` already set in your shell takes precedence over the file. If the
   database it points at doesn't exist, these fail with `database "<name>" does not exist`
   and leave you with no tables — check the database name in the URL first.

   Both commands work from any shell (bash, PowerShell, cmd) and are safe to rerun —
   templates upsert by key rather than duplicating. Rerunning after a template's fields
   change only affects collections created *afterwards*: `createCollection()` copies the
   field defs onto the collection row, so an existing shelf keeps the columns it was made
   with.

5. **Demo data (optional).** Creates a demo account with three populated collections —
   Video Games (10 items), Books (9), and Manga (6):

   ```bash
   npm run db:seed -- --demo
   ```

   Login with `demo@example.com` / `demopassword123`. This also runs the template seed from
   step 4, so it's fine as your only seed command. Rerunning is safe: it skips the demo user
   and any collection it already created, so edits you make to the demo data survive.

6. **Run:**

   ```bash
   npm run dev
   ```

   Or fully containerized instead of steps 1/6 — build and run the app itself in Docker
   too (still needs steps 2–4 for the database, plus 5 if you want demo data; copy
   `BETTER_AUTH_SECRET` from `.env.local` into a top-level `.env` file first, since Compose
   reads that separately — and `IGDB_CLIENT_ID`/`IGDB_CLIENT_SECRET`/`TMDB_API_KEY` with it
   if you want metadata lookups in the container, which are otherwise just absent):

   ```bash
   docker compose up -d --build app
   ```

## Scripts

| Command | Does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` / `npm run start` | Production build / serve |
| `npm run db:generate` | Generate a Drizzle migration from schema changes |
| `npm run db:migrate` | Apply migrations |
| `npm run db:push` | Push schema directly (no migration file — dev convenience) |
| `npm run db:studio` | Drizzle Studio (browse the DB) |
| `npm run db:seed` | Seed the 15 built-in templates (idempotent) |
| `npm run db:seed -- --demo` | Same, plus the demo account and its three collections |
| `npm run lookup:check` | Prove the metadata cache spares the provider's free tier (see below) |
| `npm run covers:backfill` | Mirror already-matched items' provider covers (dry run; `-- --apply` writes) |

## What's implemented

Auth (email/password), collections with template/blank/CSV creation, custom fields,
per-field autosave (covers + table views, optimistic with conflict detection), CSV import
into new or existing collections (type-guessing, mapping, batch rollback), sharing
(per-collection invites with viewer/editor roles, public read-only links), account settings
(profile, password, sessions, CSV/JSON export), photo upload for item covers, and metadata
lookups against IGDB (games), Open Library (books/comics/manga) and TMDB
(movies/TV shows/anime).

**Not implemented:** the MusicBrainz and Rebrickable providers — the interface and registry
in `src/lib/metadata` take them as-is, they just need keys and a `search`/`hydrate` pair
each.

## Metadata lookups

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

### Provider quirks worth knowing

- **IGDB** indexes far more than boxed releases, and unfiltered `search` ranks them
  ahead of it — "chrono trigger" puts three Satellaview add-ons above the 1995 SNES
  cartridge. Searches filter to main games, remakes, remasters, ports and expanded
  editions, and show platform and year so you can tell the releases apart.
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
  `tv:1396` so a hydrate knows which endpoint to read. TV hits are labelled "TV" in the
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

### Cover art is copied, not hotlinked

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

### Staying inside the free tier

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

`npm run lookup:check` proves this by counting outbound requests around each call rather
than trusting a cache row exists: cold search 1 request, warm 0, five concurrent identical
searches 1, cold hydrate ≥1 (Open Library's reads three records, IGDB's and TMDB's one),
warm 0, `forceRefresh` ≥1, and a row stamped with an older schema version refetches. It
purges only the rows for the query it tests. Takes a provider and query:
`npm run lookup:check -- tmdb "dune"`.

## Item photos

Covers come from a metadata provider when one has art (copied into this same store — see
above), and otherwise from a photo the owner uploads on the item detail page
(JPEG/PNG/WebP/GIF/AVIF, 10MB cap). Files land in
`UPLOADS_DIR` (default `./uploads`, a Docker volume in Compose) — no S3/R2 wiring.

Nothing is stored as sent. `src/lib/uploads/store.ts` re-encodes every upload through
sharp: EXIF orientation applied, then bounded to 1600px on the longest edge and written
as WebP. That caps what a 4000px phone photo costs to serve, drops the EXIF block (a
camera roll photo carries GPS coordinates), and means the bytes on disk are libvips
output rather than a stranger's file. Animated GIFs keep their first frame only.

Each upload also gets a 500px thumbnail at `<id>_t.webp`, which is what the covers grid
and the public share page load — a 60-tile grid of phone photos costs ~1.5MB instead of
~24MB. Only the full-size URL is stored on the item; `thumbUrlFor()` in
`src/lib/uploads/urls.ts` derives the thumb name, so there's no schema change and
provider cover URLs pass through untouched. Uploads written before thumbnails existed
have no `_t` file, and the read route falls back to the full-size image for them rather
than 404ing a tile.

Files are removed with the rows that referenced them: deleting an item, deleting a
collection (whose items go by `on delete cascade`, so their covers are read before the rows
disappear), and rolling back an import batch all sweep up after themselves. That cleanup
lives in `src/db/queries/*` rather than in the routes, so a future caller of `deleteItem`
can't forget it, and in `src/lib/uploads/files.ts` rather than `store.ts` so unlinking a
file doesn't drag sharp into that route's standalone trace.

Three things worth knowing about that path:

- Uploads are **not** under `public/`. Next indexes the public folder once at server
  start in production, so anything written afterwards 404s until a restart. They're
  served by `src/app/api/uploads/[name]/route.ts` instead, which reads per request.
- That read route is **unauthenticated by design** — public share pages (`/s/:token`)
  render covers with plain `<img>` and carry no session. The random filename is the
  capability, so anyone holding the URL can fetch the photo. Fine for shelf pictures;
  swap in signed URLs before storing anything sensitive.
- sharp ships prebuilt platform binaries, so the Docker image needs the `linuxmusl`
  ones from `package-lock.json` — regenerate the lockfile with `npm install`, never by
  hand-editing, or `npm ci` inside `node:24-alpine` won't find them.

## MySQL path (not built, but the seam is here)

`src/db/schema/*` and `src/db/client.ts` are the only DB-coupled modules; `src/db/queries/*`
is plain async functions everything else calls. To target MySQL: swap
`drizzle-orm/node-postgres` → `drizzle-orm/mysql2`, `jsonb` columns → `json` (validate shape
in the API layer instead of Postgres check constraints), replace the `jsonb_path_ops` GIN
index with per-field generated+indexed columns, and swap `gen_random_uuid()` for
app-generated UUIDs (MySQL has no native equivalent).
