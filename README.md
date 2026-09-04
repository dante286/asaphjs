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

   `ALLOW_SIGNUPS` is optional too and defaults to open. Don't set it to `false`
   yet — see [Closing registration on an instance](#closing-registration-on-an-instance),
   which needs an account to exist first.

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

5. **Demo data (optional).** Creates two demo accounts, four populated collections, and the
   membership rows that make sharing testable without setting it up by hand:

   ```bash
   npm run db:seed -- --demo
   ```

   | Account | Password | Owns | Access to |
   | --- | --- | --- | --- |
   | `demo@example.com` | `demopassword123` | Video Games (10 items), Books (9), Manga (6) | — |
   | `demo2@example.com` | `demopassword123` | Board Games (4) | editor on Video Games, viewer on Books |

   Both memberships are pre-accepted, so signing in as `demo2` shows the shared collections
   on the dashboard immediately. Two more invites are left unaccepted, at tokens fixed by the
   seed so they survive a reseed and can be pasted straight in:

   | URL | Is |
   | --- | --- |
   | `/invite/demo-invite-pending-manga` | A live invite for `demo2` to Manga. Opening it as `demo` instead hits the email-mismatch branch on the same token |
   | `/invite/demo-invite-expired-board-games` | Backdated past the 14-day cutoff, addressed to `demo` |
   | `/s/demo-share-books` | Books' public read-only link, already enabled — the collection with a borrower on it, which is what public links are supposed to withhold |

   Two accounts is also the only way to reach the concurrent-edit path: `patchItem` compares
   the client's `updatedAt` and the API answers 409, which `ConflictError` in
   `src/lib/api/items-client.ts` turns into the autosave conflict UI. Sign in as each account
   in two windows and edit the same Video Games item.

   This also runs the template seed from step 4, so it's fine as your only seed command.
   Rerunning is safe: it skips users, collections and memberships that already exist, so
   edits you make to the demo data survive — including an invite you accepted or a share
   link you rotated or switched off.

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
| `npm test` | Unit and provider tests — needs no database, no network, no env (see below) |
| `npm run test:watch` | The same tests, re-running on change |
| `npm run test:coverage` | Coverage over the tested modules |
| `npm run db:generate` | Generate a Drizzle migration from schema changes |
| `npm run db:migrate` | Apply migrations |
| `npm run db:push` | Push schema directly (no migration file — dev convenience) |
| `npm run db:studio` | Drizzle Studio (browse the DB) |
| `npm run db:seed` | Seed the 15 built-in templates (idempotent) |
| `npm run db:seed -- --demo` | Same, plus the two demo accounts, their collections, and the sharing fixtures |
| `npm run lookup:check` | Prove the metadata cache spares the provider's free tier (see below) |
| `npm run covers:backfill` | Mirror already-matched items' provider covers (dry run; `-- --apply` writes) |

## Tests

`npm test` runs two Vitest projects, `unit` and `providers`. Both need **nothing set
up**: no database, no network, no browser, no environment variables. Together they run in
well under a second from a clean checkout. Vitest doesn't hand `.env` to `process.env`, so
a machine with a full `.env` and a fresh clone behave identically.

### The unit tier

The pure-logic modules — the ones holding the decisions that are hard to check by eye.
`buildPrefillPlan` deciding which provider values may overwrite an owner's own data,
`guessColumnType` deciding what a CSV column *is*, `NAME_PATTERN` deciding which upload
names can't escape the uploads directory, and `stripItemsForPublic` deciding what a
stranger with a share link may see. The two modules that do read env (`signupsAllowed`,
`resolveLookupConfig`) stub it in both directions rather than inheriting whatever the
developer happens to have exported.

The rate limiter is here too, on fake timers, because its whole subject is a one-second
refill window — including the footgun that `getLimiter` memoises by key and silently
ignores the capacity of a second call for a key it already has. `withCache` is here as
well, with `@/db/queries/metadata` mocked: its schema-stamp checks and its single-flight
coalescing are decisions this module makes on its own, and four mocked functions are
cheaper than a Postgres instance for them.

### The providers tier

The three metadata providers, faked with [MSW](https://mswjs.io). MSW intercepts below
`fetch`, so `igdb.ts`, `tmdb.ts` and `openlibrary.ts` run completely unmodified — real URL
and header construction, real status handling, real parsing — and the specs assert on the
request that came out the far end as well as on the fields that came back. What that
protects is a pile of provider quirks otherwise recorded only as comments: IGDB's
`t_thumb` cover URLs and Unix-**seconds** release dates, TMDB choosing between a v3 key
and a v4 token by matching the credential's *shape*, Open Library's `-1` cover placeholder
and its `form:manga` machine tags. Each is a silent-wrong-data bug if it regresses.

**No credentials, and no way to need them.** `src/test/providers/setup.ts` deletes
`IGDB_CLIENT_ID`, `IGDB_CLIENT_SECRET` and `TMDB_API_KEY` from `process.env` before any
provider module is imported and installs obvious fakes in their place, so a runner that
did have real ones can't leak them into a call. MSW then runs with
`onUnhandledRequest: "error"`, which is what makes the hermetic claim enforceable rather
than aspirational: any request no handler claims **fails the test**. Repointing TMDB's
base URL at an unmocked host, to check that, failed 17 of its 24 tests instead of reaching
the network — the 7 that still passed are the ones that make no request at all.

The fixtures are hand-authored against each provider's own declared response types
(`IgdbGame`, `TmdbSearchResult`, `OpenLibraryDoc`, `OpenLibraryWork`) with `satisfies`, so
a change to a provider's types breaks the fixture rather than letting it drift into
fiction. None of it is recorded traffic, which is why none of it needed a key to produce.
`npm run lookup:check` still runs against the *real* providers and remains the only thing
that can catch a provider changing its response shape on us — MSW fixtures by construction
cannot.

This tier also replaces `rate-limiter.ts` with a pass-through. Every provider builds its
limiter at module load, and Open Library's is capacity 1 refilling once a second while its
`hydrate` makes up to five requests — one unmitigated test would spend four seconds of
wall clock for no signal about anything this tier tests.

### Conventions

Tests are colocated as `*.test.ts` next to their subject, so an untested module is visible
in a directory listing — except under `src/app/`, where the App Router matches files by
convention and a stray sibling is asking for trouble. Which tier a spec belongs to follows
from where it lives: everything under `src/lib/metadata/providers/` is the providers tier,
everything else the unit tier. The shared MSW plumbing sits in `src/test/providers/`.

There's no DOM environment on purpose. Every page under `src/app/(app)` is an async Server
Component, which Vitest can't render, so jsdom would buy a slower run and nothing else —
components belong to an E2E suite. Coverage is reported over an allowlist of the tested
modules rather than the whole tree, and carries no thresholds: the route handlers, server
actions and query functions are uncovered by design here, so a whole-tree percentage would
be a number about work these tiers aren't doing. The three providers, `cached-provider.ts`
and `rate-limiter.ts` are at 100% of statements, branches, functions and lines.

Three bugs the suite turned up while being written are held as `skip`ped tests rather
than deleted, each one the assertion that *should* pass: `timeAgo` renders days 360
through 364 as "0 years ago" (#41), `cloneTemplateFields` shares a select's `options`
array with the template row it copied, which is the exact thing its comment says it
prevents (#42 — latent, since nothing calls it yet), and a TMDB source id with an empty
id half (`"movie:"`) slips past `decodeSourceId` because `Number("")` is 0, spending a
request to reject something the guard exists to reject for free (#44). All three are
behaviour changes, so they're tracked on their own rather than folded in here.

## What's implemented

Auth (email/password), collections with template/blank/CSV creation, custom fields,
per-field autosave (covers + table views, optimistic with conflict detection), CSV import
into new or existing collections (type-guessing, mapping, batch rollback), sharing
(per-collection invites with viewer/editor roles, public read-only links), account settings
(profile, password, sessions, rename/delete per collection, CSV/JSON export, account
deletion), photo upload
for item covers, and metadata lookups against IGDB (games), Open Library
(books/comics/manga) and TMDB (movies/TV shows/anime).

### Closing registration on an instance

`ALLOW_SIGNUPS=false` closes registration: the "Create account" segment disappears from
`/auth` and the sign-up API answers 400 `EMAIL_PASSWORD_SIGN_UP_DISABLED`. It's the switch
for running Asaph for one person or a household on a URL anyone can reach. Set it in
`.env.local` for local dev, or the top-level `.env` for Compose, and restart the server —
`betterAuth()` reads the flag once at startup.

Only the literal `false` closes signups. Unset, empty, or a typo (`fasle`, `no`, `0`) leaves
them open. That's deliberate: failing *closed* on a typo would be safer for a private
instance, but the failure it creates is worse — an operator with no account and no UI to fix
it, needing an env edit and a redeploy to get back in. Open-on-garbage is the recoverable
mistake.

One option covers both entry points. `signUpAction` calls `auth.api.signUpEmail` rather than
reimplementing the insert, so `emailAndPassword.disableSignUp` in `src/lib/auth/auth.ts`
rejects the Server Action and `/api/auth/sign-up/email` on the same check — there's no second
guard to write, and so no way for the two to drift apart. Hiding the tab in `AuthForm` is
about honesty, not enforcement: a closed door shouldn't be something you discover by filling
in a form and submitting it.

**Create your account before you close registration.** A fresh deployment with
`ALLOW_SIGNUPS=false` and an empty `user` table has no way in at all — no first-run bootstrap,
no admin CLI. Sign up first, confirm you can sign in, *then* flip the flag and restart. If you
seeded with `npm run db:seed -- --demo`, the `demo@example.com` account described in step 5
already exists and is a usable way in, so a demo instance can be closed straight away — change
its password first, since the seed's is published on this page.

**Invites only work for people who already have an account.** An invite token doesn't
authorize a registration. `/invite/:token` sends a signed-out visitor to
`/auth?next=/invite/:token`, and with signups closed the only thing there is a sign-in form —
so an invited person with no account cannot accept, and the invite is dead. The invite page
says as much when the flag is set rather than sending them to `/auth` to find the tab missing.
Sharing on a closed instance means everyone you share with has an account you made while
registration was open.

### Deleting an account sweeps its uploads first

The Security section of `/account` has a Delete account action. It asks for the password —
not for a typed-out confirmation phrase — because `auth.api.deleteUser` asks for one itself:
without a password it insists the session be fresher than `freshAge` (a day), so someone
signed in since last week would get `SESSION_EXPIRED` from a button that looked ready.
Asking every time makes the gate the same gate every time, and a live session on a borrowed
laptop can't get through it. The confirmation links to the CSV and JSON exports, which is
the whole of the export-before-delete story here.

Deletion is the cascade the uploads store can least afford. `collections.owner_id` is
`on delete cascade` and items cascade from collections, so removing one `user` row takes
every collection and item with it in a single statement the app never sees row by row —
and every re-encoded WebP and `_t` thumbnail those items named would sit in `UPLOADS_DIR`
with nothing left that could ever reach them. So the sweep hangs off Better Auth's
`user.deleteUser.beforeDelete` hook (`src/lib/auth/auth.ts`), which runs *before*
`internalAdapter.deleteUser`: the rows are still there, their cover URLs are still
readable, and the ordering is the same read-before-delete one `deleteCollection` uses one
level down. `afterDelete` was the wrong hook for exactly the reason it looks like the right
one — it fires when the deletion is safely done, which is also when the record of what to
delete is gone.

The gathering lives in `deleteUploadsForOwner()` in `src/db/queries/collections.ts`, beside
the other sweeps rather than inline in the auth config, so the next caller can't forget it.
It joins items to collections and filters on `owner_id`, and that join is the point: an
editor on somebody else's collection can upload a photo to an item there, and that item
outlives them — unlinking its file would blank a cover in a collection whose owner never
asked for anything. Nothing in the hook catches, either. A covers list we can't read is a
sweep we can't perform, and refusing the deletion beats stranding someone's photos on disk
forever; the unlinks themselves stay best-effort, so an already-missing file doesn't stop
anyone leaving.

**`collection_members.invited_by` needed an `on delete` action for any of this to work**
(migration `0005`). It had none, so it defaulted to `no action` — and account deletion then
failed outright for any owner who had ever sent an invite. Deleting the `user` does cascade
to `collections` and on to these rows, but Postgres fires both referential triggers as
after-row triggers on the same statement in constraint-name order, and
`collection_members_invited_by_…` sorts ahead of `collections_owner_id_…`: the check ran
against rows that hadn't been cascaded away yet and raised `23503`. It's now `set null`
rather than `cascade`, because cascade would be a promise the column can't keep — it would
take the membership along with the inviter, and who invited whom is provenance while the
membership is the fact. Worth knowing if you hit a similar constraint: Better Auth's delete
isn't wrapped in a transaction, so the failed attempt still removed the `account` row before
the `user` delete blew up, leaving a user who could no longer sign in.

### Renaming moves a collection's URL

A collection's slug is derived from its name, and renaming from account settings
regenerates it — so "TV Shows" renamed to "Movies" moves from `/collections/tv-shows` to
`/collections/movies`, and links to the old address 404. That's deliberate: the URL is
worth keeping honest while the app is young and nobody has bookmarks worth breaking. If
that ever costs something, the fix is a slug-alias (or slug-history) column that keeps
resolving old addresses and redirects them to the current one — public share links are
token-based (`/s/:token`), so they already survive a rename untouched.

The regeneration lives in `updateCollectionSettings()` in `src/db/queries/collections.ts`
rather than in the action, alongside the uniqueness loop that `createCollection` uses, so a
future caller can't rename a collection and leave its URL pointing at the old name. That
loop excludes the collection's own row when renaming — otherwise a collection renamed to
the name it already has would collide with itself and creep to `movies-2`.

### Slugs are unique across the table, not per owner

`/collections/:slug` has no owner in it, so it's resolved against whoever is viewing. While
slugs were unique only per owner, two people could each hold `movies`, and the lookup
answered with whichever one the viewer owned — so a collection shared with you was
unreachable at its own URL whenever you happened to own one by the same name, and the
dashboard still linked to it. The unique index is on `slug` alone for that reason: at most
one row can match a path, which turns `getCollectionForUser()` from a choice between
candidates into a lookup.

The trade is that the second person to name a collection "Movies" gets
`/collections/movies-2`, and Movies and Books are exactly the names two people both use, so
the suffix fires far more often than it used to. That's the cost of an owner-free readable
URL, and it's paid once when a collection is created or renamed rather than by a viewer who
can't reach a collection at all. The alternatives were owner-scoped paths
(`/collections/:owner/:slug`, which changes every URL) or routing on the collection id
(rename-proof, but opaque).

Minting a suffix is a read followed by a write, so the slug it picks can be claimed by
another request before the write lands — and the write then fails on
`collections_slug_unique` for a name that really was free. That gap existed under the
per-owner constraint too, but reaching it took one owner creating the same name twice at
once; making the namespace global made it contended *between* people, over exactly the names
two people both use. `withFreshSlug()` in `src/db/queries/collections.ts` closes it: on a
`23505` naming that constraint it re-mints and writes again, up to `SLUG_ATTEMPTS`. Both
`createCollection` and the rename in `updateCollectionSettings` go through it, which also
covers CSV import, since that creates its collection the same way.

A bounded retry rather than a lock or a slug-picking statement: the loser re-reads, finds
the suffix taken while it waited, and takes the next one — and an uncontended create pays
nothing it didn't pay before. Measured on Postgres 18, ten rounds per level: three
simultaneous creates of one name failed 10 of 30 before this and 0 of 30 after, and the cap
of 8 holds to 0 failures through eight-way contention (1 of 120 at twelve-way). Past that a
caller sees the driver's error and can retry, which is what it saw at three-way before.

Existing duplicates are resolved by `drizzle/migrations/0003_dedupe_collection_slugs.sql`,
which runs before the constraint swap in `0004`: the oldest collection keeps the bare slug
and the rest take the same `-2`/`-3` suffixes the app hands out, so a backfilled slug is
indistinguishable from a minted one. **Whoever loses the bare slug has its URL changed by
the migration** — same one-way trade as a rename, and unavoidable if the path is to
identify one collection.

**Not implemented:** the MusicBrainz and Rebrickable providers — the interface and registry
in `src/lib/metadata` take them as-is, they just need keys and a `search`/`hydrate` pair
each.

### Turning a public link off keeps its address

Unticking "Public link" writes `share_enabled = false` and leaves `share_token` alone, so
ticking it again hands out the same `/s/:token` URL instead of a fresh one. That's deliberate —
a link pinned in a group chat survives the collection going quiet for a month — but it means
switching the link off is not how you retire an address that got out. It hides it, and the next
tick republishes it verbatim.

**Rotate link** is how you retire one. `rotateShareTokenAction` writes a new `nanoid(24)` over
the old token, and `getCollectionByShareToken` matches on the token, so the previous URL stops
resolving the moment the rotation lands — for everyone, including the people you meant to share
it with. There is no grace period and no alias table: half-invalidating a leaked link would be
worse than not offering the control.

The control appears whenever a token exists, not only while the link is switched on. The owner
most likely to reach for it is the one who noticed the leak and unticked the box first, and
gating rotation behind the checkbox would have made them republish the leaked URL to get at the
control that replaces it. When the link is off, the card says so and says the address is
remembered, since a "Rotate link" button next to no visible URL otherwise reads as dead UI.

Neither action returns the new token to the client. `togglePublicLinkAction` and
`rotateShareTokenAction` both call `refresh()`, and `/account` rebuilds the URL from the token
and the request origin (`src/lib/request-origin.ts`) — that's why enabling a link for a
collection that never had one shows its address immediately rather than after a manual reload,
and why the displayed URL changes under a rotation without the card tracking a token in state.

### A read-only view is a view with no handlers

The public share page (`/s/:token`) is a Server Component, so it can't hand `CoversView` or
`TableView` a callback — a function prop doesn't survive the trip into a Client Component,
and satisfying the types with `onOpenItem={() => {}}` made the page 500 for every public
link until it was fixed. So the views take their callbacks as **optional**, and their
absence is what puts them in read-only mode: no click target, no resize handle, no
edit-and-autosave hint, and a plain title instead of a button that opens nothing.

`CoversView` has no `"use client"` and no hooks, so it takes its environment from whoever
imports it: rendered from the share page it's a Server Component that ships no JS for the
grid at all. `TableView` uses hooks and is a real client component, so there it hydrates
with only serializable props. If you add a callback prop to either, make it optional too —
a required one silently forces every caller to be a client component.

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
disappear), deleting an account (the same cascade one level up — see above), and rolling
back an import batch all sweep up after themselves. That cleanup
lives in `src/db/queries/*` rather than in the routes, so a future caller of `deleteItem`
can't forget it, and in `src/lib/uploads/files.ts` rather than `store.ts` so unlinking a
file doesn't drag sharp into that route's standalone trace.

Four things worth knowing about that path:

- Uploads are **not** under `public/`. Next indexes the public folder once at server
  start in production, so anything written afterwards 404s until a restart. They're
  served by `src/app/api/uploads/[name]/route.ts` instead, which reads per request.
- That read route is **unauthenticated by design** — public share pages (`/s/:token`)
  render covers with plain `<img>` and carry no session. The random filename is the
  capability, so anyone holding the URL can fetch the photo. Fine for shelf pictures;
  swap in signed URLs before storing anything sensitive.
- Reads and writes against that directory are marked `/*turbopackIgnore: true*/`.
  `UPLOADS_DIR` points at a mounted volume, so the paths only exist at runtime and the
  build tracer can't statically scope them. Left alone it assumes the worst and traces the
  whole project into `.next/standalone` — `src/`, `README.md`, `scripts/`, `drizzle/`, and
  the developer's own local `uploads/` all ride along into the deploy image. The annotation
  is what makes the Dockerfile's claim of tracing "only the files next start actually
  needs" true.
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
