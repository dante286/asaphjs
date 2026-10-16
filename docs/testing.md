# Testing

Four tiers, three of them Vitest projects. `npm test` runs `unit` and `providers`, which
need **nothing set up**: no database, no network, no browser, no environment variables.
Together they run in well under a second from a clean checkout. Vitest doesn't hand `.env`
to `process.env`, so a machine with a full `.env` and a fresh clone behave identically.

`npm run test:db` runs the third, `integration`, against a real Postgres — one
`docker compose up -d db` away. `npm run test:e2e` runs the fourth, `smoke`, in a browser
against the standalone build. Both are named explicitly rather than excluded from
`npm test`: a tier that needs infrastructure has to opt *in*, or the promise that
`npm test` works from a clean checkout lasts exactly until someone adds a tier.

The tiers are ordered by what they cost to write, run and debug, and each one is meant to
hold only what the cheaper tier below it genuinely can't. That's why the smoke tier has
four specs and not forty.

## The unit tier

The pure-logic modules — the ones holding the decisions that are hard to check by eye.
`buildPrefillPlan` deciding which provider values may overwrite an owner's own data,
`guessColumnType` deciding what a CSV column *is*, `NAME_PATTERN` deciding which upload
names can't escape the uploads directory, and `stripItemsForPublic` deciding what a
stranger with a share link may see. The modules that do read env (`signupsAllowed`,
`resolveLookupConfig`, the SMTP settings) stub it in both directions rather than
inheriting whatever the developer happens to have exported.

The email specs are the one place this tier opens a socket. It's a loopback listener in
the same process, `src/test/email/fake-smtp.ts`, which plays an SMTP server that never
speaks TLS. Asserting that `transportOptions` returns `requireTLS: true` would still pass
if the key were misspelled, because nodemailer ignores keys it doesn't know and would
send in the clear. So the TLS rules are checked by handing those exact options to the
real nodemailer client and watching whether it delivers the body. `sendEmail` itself is
tested with a capture transport: `createTransport` is mocked to return nodemailer's own
stream transport, so messages are fully composed but land in an array instead of on a
socket.

The rate limiter is here too, on fake timers, because its whole subject is a one-second
refill window — including the footgun that `getLimiter` memoises by key and silently
ignores the capacity of a second call for a key it already has. `withCache` is here as
well, with `@/db/queries/metadata` mocked: its schema-stamp checks and its single-flight
coalescing are decisions this module makes on its own, and four mocked functions are
cheaper than a Postgres instance for them.

## The providers tier

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
`onUnhandledFrame: "error"`, which is what makes the hermetic claim enforceable rather
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

## The integration tier

`src/db/queries/` is about 1,000 lines of Drizzle that every route and action funnels
through, and the rules that matter are in the SQL rather than around it: `patchItem` merges
and deletes jsonb keys with a raw `||` / `- text[]` expression inside a transaction that
takes `FOR UPDATE`; `resolveRole` is the authorization decision the whole app rests on;
`getCollectionStats` counts with `count(*) filter (...)`; `sortTitle` is a generated column
Postgres maintains. None of that means anything against a substitute.

**Real Postgres, not an emulator.** `pg-mem` and PGlite were both considered and neither
survives migration `0000` — the schema uses generated columns, a `jsonb_path_ops` GIN
index, `count(*) filter`, `SELECT ... FOR UPDATE`, and `0003` is a hand-written `DO $$`
data migration. Emulation would fail before the first test ran. `docker-compose.yml`
already pins `postgres:18-alpine`; CI gets the same image as a service container.

**A template database, cloned per worker.** Migrations run once per `vitest run` into
`asaph_test_template`, and each Vitest worker does `CREATE DATABASE ... TEMPLATE ...`,
which on Postgres is a filesystem copy and costs tens of milliseconds. That is what makes
the isolation problem go away rather than be worked around: `src/db/client.ts` exports one
module-level pool and every query module imports it directly, so there is no seam to inject
a transaction through — the usual transaction-per-test-with-rollback would mean mocking the
singleton wholesale, *and* it would make the concurrency test below impossible by
construction. A database per worker means the shared pool is simply pointed somewhere
private. Nothing outside `asaph_test_*` is ever created, written or dropped; the database
named in your `DATABASE_URL` is read for its server address and otherwise left alone.

Between tests, one `TRUNCATE ... RESTART IDENTITY CASCADE` over every table, then a
`DELETE FROM "user"`. The two statements are deliberate: `CASCADE` also truncates anything
holding a foreign key into what it truncated, and `templates.owner_id` references `user` —
so truncating users takes the seeded system templates with it. Deleting users row by row
runs the schema's own `on delete cascade` instead, which removes only the templates a test's
user owned and leaves the 15 system rows (owner `null`) that collection creation clones
from.

The databases are dropped again when the run ends. `KEEP_TEST_DATABASES=1 npm run test:db`
leaves them, which is what to reach for when a spec fails and the rows it left behind are
the evidence — the next run drops them anyway.

**The concurrency test is the point.** `withFreshSlug` retries when the unique index claims
a slug between minting it and writing it — the most recently changed code in the repo, and
behaviour that exists only across genuinely concurrent connections. Three simultaneous
`createCollection("Movies")` calls all land with distinct slugs; so do eight; so do four
simultaneous renames onto one name. Removing the retry loop fails all three with `duplicate
key value violates unique constraint "collections_slug_unique"`, which was checked rather
than assumed — a concurrency test that passes against broken code is worse than no test.

Users are created through `auth.api.signUpEmail`, not by inserting into `user` and
`account`. Authentication here is email/password against our own Postgres with no external
identity provider, so there is nothing to stub, and a hand-rolled insert would only be a
second, wrong implementation of Better Auth's schema. Cover deletes write and then look for
real files, under a per-worker directory in the OS temp folder rather than the repo's own
`uploads/`.

**The route handlers and server actions are in this tier too**, because they are where
authorization actually happens and the alternative is clicking through the UI as one user at
a time — which is exactly how you never notice that an editor can reach an owner-only
action. `requireRole` is tested as a matrix: five kinds of caller (owner, editor, viewer,
share link, anonymous) against each `allowed` set the handlers pass, so a hole shows up as a
failing row rather than as a support question.

Calling a route handler is calling a function. `requireRole` reads `request.headers`, not
`next/headers`, so a spec builds a `Request` carrying a real Better Auth session cookie —
signed by the library, validated by the library — and invokes the exported `GET`/`POST`/
`PATCH`/`DELETE` directly. No HTTP server, no route mocking, no Next request scope. The
`/api/lookup` route and the Server Actions do reach `next/headers`, so those specs mock that
one function and nothing else; the session validation stays real, which is what makes
"signed out" the library's answer rather than a stub's.

What that buys, beyond status codes: the photo route's 10MB cap is checked twice (once on
the client's own `content-length`, once on the decoded part) and both are exercised; a patch
that fails after the file is written leaves an empty uploads directory, asserted by reading
the directory rather than by trusting the code path; `/api/uploads/[name]` — deliberately
unauthenticated, since covers render on public share pages with no cookie — gets seventeen
traversal probes (`../`, `..%2f`, a null byte, an `.svg`, an over-long stem) and every one
404s; and `applyLookupAction`'s compensating delete is checked by mirroring a real cover
through sharp and then losing the race.

The whole failure ladder of `/api/lookup/[provider]/search` is reachable with **no
credentials at all** — 401 without a session, 400 for an unknown provider or a query under
two characters, 503 for a provider with no key configured, 502 by pointing MSW at a 500 —
which is a property of how `isProviderConfigured` was written rather than a coincidence.

This tier also stands MSW up beside Postgres, which is what makes the metadata cache
testable at all: it needs the rows on one side and a way to count outbound requests on the
other. The cache spec asserts its claims in requests spent rather than in rows written,
because a hit and a miss return the same fields — see [Staying inside the free tier](design/metadata.md#staying-inside-the-free-tier)
for what it checks and how it divides labour with `npm run lookup:check`.

CI runs all of this as its own job against a `postgres:18-alpine` service container with no
secrets, and applies the migrations to an empty database as a separate step before any spec
runs — nothing else proves `drizzle/migrations/meta/_journal.json` is consistent with the
files beside it.

## The smoke tier

Four Playwright specs in `tests/e2e/`, Chromium only, against a server that is either the
standalone build or the container image itself. They are the most expensive tests here by
every measure, so they hold only the four assertions that cannot live anywhere cheaper.

**`next start` would be a false pass, and so would half the obvious alternatives.** The
failure this tier exists for is a build that succeeds and then throws: standalone tracing
follows JS and `.node` binaries but not the shared library one of those binaries `dlopen`s,
so `@img/sharp-<platform>/lib/*.node` gets traced and
`@img/sharp-libvips-<platform>/lib/libvips-cpp.so.*` is left behind, and the photo routes
die with `ERR_DLOPEN_FAILED` on a build and typecheck that were both clean. `next start`
serves from the full `node_modules`, where libvips is present whatever the tracer decided,
so it cannot reproduce this at all.

Running `.next/standalone/server.js` in place can't either, for the same reason one
directory deeper: Node walks up out of `.next/standalone/node_modules` into the repo's real
`node_modules` and finds the whole install. `scripts/e2e/standalone-server.mjs` therefore
copies the output to a staging directory outside the tree first, and copies it
*dereferencing symlinks* — Turbopack leaves relative links in `.next/node_modules`
(`sharp-<hash>` -> `../../node_modules/sharp`) that Docker's `COPY` keeps relative and
resolves inside `/app`, while Node's `fs.cp` rewrites them to absolute paths back into the
source tree, which quietly restores the fallback the staging was there to remove. With
that closed, deleting `@img` from the traced output turns the photo spec red, locally and
in an image alike.

**The tracer used to need a hint here, and no longer does.** `next.config.ts` carried an
`outputFileTracingIncludes` block pulling `./node_modules/@img/**/*` into two route traces,
written when the tracer stopped at the `.node` binary and left libvips behind. On the
versions pinned here — Next 16.3.4, sharp 0.35.4 — it follows the shared library on its
own, and the block's own build said so: five traces picked up `@img` while the two globs
named only two of them, and one of the two globs was reaching a route that doesn't use
sharp at all. Rebuilt from a cleared `.next` without the block, `@img` lands in exactly the
four traces that load sharp — the photo route, the items `POST` route (through
`mirrorCover`), and the collection and item detail pages (through the metadata server
actions) — and `.next/standalone/node_modules/@img/sharp-libvips-linux-x64/lib` holds
`libvips-cpp.so.8.18.6`. Verified on both sides of the libc split: a host build against
glibc, and the alpine image through `docker-e2e`, where sharp resolves
`@img/sharp-linuxmusl-x64` and `@img/sharp-libvips-linuxmusl-x64` instead. If a future
version regresses this, narrow the hint to those four routes and write the trace listing
down beside it — don't restore two globs that had already drifted out of step with which
routes touch sharp.

What the four specs cover:

- **The photo upload.** Uploads an image, asserts the cover resolves to
  `/api/uploads/<id>.webp`, and fetches both that URL and its `_t` thumbnail expecting 200,
  `image/webp`, and a `RIFF`/`WEBP` container signature — the header alone proves nothing,
  since the route derives it from a filename the store hardcodes. One upload settles that
  sharp loaded inside the trace, that the re-encode ran, that the thumbnail pair was
  written, that `UPLOADS_DIR` is honoured, and that the read route serves from outside
  `public/`. The thumbnail's body has to be *smaller* than the full-size one, because the
  read route falls back to the full file for a `_t` name that isn't on disk and a missing
  thumbnail would otherwise look like a pass.
- **The public share page redacts.** Creates an item with a distinctive borrower and notes,
  enables the link, and opens it in a fresh unauthenticated context. `stripItemsForPublic`
  has a unit test; this proves it's applied on the rendered path. The assertion is against
  the page *source*, not its text: the collection defaults to table view, `TableView` is a
  Client Component, and its rows are serialized into the RSC payload whether or not a given
  column is on screen. Both needles are plain ASCII, since an escaped apostrophe would make
  `not.toContain` pass for the wrong reason.
- **The middleware redirect.** `middleware.ts` is imported by nothing and appears in no
  trace anyone reads; a build that dropped it would be green everywhere else while leaving
  every protected page open. Includes the counterpart — `/s/:token` still answers signed
  out, which is why the matcher is a list rather than a catch-all.
- **Missing provider keys degrade quietly.** The server runs with no IGDB or TMDB
  credentials: no lookup panel in either the create dialog or the detail page, and item
  creation still works. The end-to-end form of the constraint the whole strategy is built
  around.

Open Library needs no credentials, so `isProviderConfigured("openlibrary")` is permanently
true and a Books, Comics, Manga or Strategy Guides collection renders a live lookup panel
that would hit the real openlibrary.org from CI. **Every spec uses the Video Games
template**, which resolves to IGDB and has no keys here. The local server script blanks
`IGDB_*` and `TMDB_API_KEY` rather than inheriting them, so a developer with real keys in
`.env.local` doesn't fail the fourth spec and start spending their own quota on every run.

Each spec signs up its own throwaway account, which is what lets workers run in parallel
against one database. No visual regression testing and no cross-browser matrix. Nothing a
route or query test could answer more cheaply — no role matrices, no `If-Match` conflicts,
no CSV import; those are in the integration tier already.

CI runs this as `docker-e2e`, which builds the image without pushing it and drives the
running container. The build and the browser run share one job on purpose: `load: true`
puts the image in that runner's Docker daemon, and a separate job couldn't see it without
round-tripping a ~400MB tarball through artifact upload and download, which costs about
what the browser run costs in the first place. Postgres is a plain container on a
user-defined network rather than a `services:` block, because the app container has to
reach it by name while the migrate and seed steps reach it on a published port — the
alternative is `--network host` and an assumption about the runner's Docker that doesn't
hold on a laptop. The image is built with **no build arguments**, the same way `release.yml`
builds what it publishes, so the run doubles as the regression test for the image being
origin-agnostic. The container's log is printed on failure: a missing native library
reaches the specs as a dialog that never closed, and the reason is only in there.

## Conventions

Tests are colocated as `*.test.ts` next to their subject, so an untested module is visible
in a directory listing — except under `src/app/`, where the App Router matches files by
convention and a stray sibling is asking for trouble. The route-handler specs are the one
thing that can't be colocated for that reason, so they live in `src/test/api/`, one file per
route, named for the route they call. Server Actions aren't under `src/app/`, so those sit
next to their subject like everything else.

Which tier a spec belongs to follows from where it lives or what it's called: everything
under `src/lib/metadata/providers/` is the providers tier, `*.db.test.ts` anywhere is the
integration tier, `tests/e2e/*.spec.ts` is the smoke tier — the one that sits outside `src/`
entirely, because it drives a running server rather than importing anything — and everything
else is the unit tier. The naming rather than a directory for that last one, because a
module often has both kinds — a pure function worth testing with nothing running next to
code that needs a server (`slugify` beside `withFreshSlug`,
`stripItemsForPublic` beside `patchItem`). Shared plumbing sits in `src/test/providers/` and
`src/test/db/`.

There's no DOM environment in any Vitest project, on purpose. Every page under
`src/app/(app)` is an async Server Component, which Vitest can't render, so jsdom would buy
a slower run and nothing else — the components are the smoke tier's business, in a real
browser, and only where a component is the only place an assertion can live. Coverage is reported over an allowlist of the tested
modules rather than the whole tree, and carries no thresholds: React components are
uncovered by design here, so a whole-tree percentage would be a number about work these
tiers aren't doing. Across that allowlist — the providers, the query layer, the route
handlers, the server actions and the pure-logic libraries — it stands at 98% of statements,
95% of branches and 100% of functions. `test:coverage` runs all three projects and therefore
wants the database up.

What's left uncovered is, deliberately, the branches that can't be reached without mocking
the client: `row?.count ?? 0` after an aggregate that always returns a row, a
`collection?.fields ?? []` for a collection that vanished between the guard and the read, a
`catch` for a Better Auth error that isn't an `APIError`. Two of them are a live oddity
rather than defensive code — `view-prefs` has a branch for a caller its own guard already
refuses (#47).

Two bugs the suite turned up while being written are held as `skip`ped tests rather
than deleted, each one the assertion that *should* pass: `timeAgo` renders days 360
through 364 as "0 years ago" (#41), and `cloneTemplateFields` shares a select's `options`
array with the template row it copied, which is the exact thing its comment says it
prevents (#42 — latent, since nothing calls it yet). Both are behaviour changes, so
they're tracked on their own rather than folded in here. A third — a TMDB source id with
an empty id half slipping past `decodeSourceId`, because `Number("")` is 0 — has since
been fixed (#44), and its cases run with the other malformed-id ones.
