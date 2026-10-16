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

### Why `package.json` overrides esbuild

`drizzle-kit` declares `@esbuild-kit/esm-loader`, a package that was folded into `tsx` years
ago and now exists only to drag in `esbuild@0.18.20` — the version GHSA-67mh-4wv8-2f99 covers,
where the dev server answers cross-origin reads of your source. Nothing in the shipped
`drizzle-kit` bundle imports it (`grep -rl esbuild-kit node_modules/drizzle-kit` matches the
manifest and nothing else), so it is a dependency that gets installed and audited but never run.

No drizzle-kit release drops it: 0.31.10 is the newest 0.x and still declares it, and the only
thing past it is a 1.0.0 release candidate. So the override pins that one edge:

```json
"overrides": { "@esbuild-kit/core-utils": { "esbuild": "^0.25.4" } }
```

Scoped to `@esbuild-kit/core-utils` rather than applied tree-wide, because `tsx` and Vite
already resolve 0.28.2 and a blanket `^0.25.x` would *downgrade* them — a caret on a `0.x`
version pins the minor. `^0.25.4` is the range drizzle-kit uses for its own direct `esbuild`
dependency, so the two dedupe to one 0.25.12 copy instead of adding a second platform-binary
tree. Delete the override when drizzle-kit drops the dependency.

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

   The `SMTP_*`/`EMAIL_FROM` variables are optional as well. Without them, mail that
   would have been sent is printed to the dev server's console. To see it rendered
   instead, see [Seeing mail locally with Mailpit](#seeing-mail-locally-with-mailpit).

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

## Running the published image

Every `v*` tag publishes an image to
[`ghcr.io/dante286/asaphjs`](https://github.com/dante286/asaphjs/pkgs/container/asaphjs), so
you don't have to build one:

```bash
docker pull ghcr.io/dante286/asaphjs:0.1.0
```

The tags are `0.1.0`, the floating `0.1`, `latest`, and a `sha-<commit>` for pinning to an
exact build. There is deliberately no bare `0`: this is 0.x software, where the minor number
is where breaking changes live, so a floating major would quietly carry you across them.
`latest` and the minor tag skip prereleases. `linux/amd64` only — see
[Architectures](#architectures).

The image is the app and nothing else. It needs a Postgres 14+ (18 recommended) that has
already been migrated and seeded, and it does neither at boot — `drizzle-kit` isn't in the
image. Run `npm run db:migrate && npm run db:seed` from a checkout against the same database
before the first start, and again after an upgrade whose release notes mention a migration.

```bash
docker run -d --name asaph -p 3000:3000 \
  -e DATABASE_URL=postgresql://postgres:mysecretpassword@host.docker.internal:5432/asaph \
  -e BETTER_AUTH_SECRET="$(openssl rand -base64 32)" \
  -e BETTER_AUTH_URL=http://localhost:3000 \
  -v asaph-uploads:/app/uploads \
  ghcr.io/dante286/asaphjs:0.1.0
```

`DATABASE_URL` and `BETTER_AUTH_SECRET` are the only two *required* variables;
`BETTER_AUTH_URL` is optional but worth setting, for the reasons under
[Origins](#origins-nothing-to-bake-in-but-do-set-better_auth_url).
Everything in
[`.env.example`](.env.example) works here too: `ALLOW_SIGNUPS=false` to
[close registration](#closing-registration-on-an-instance), and the `IGDB_*`/`TMDB_API_KEY`
credentials for [metadata lookups](#metadata-lookups), which are simply absent without them,
and the `SMTP_*`/`EMAIL_FROM` settings for [sending email](#sending-email). Without those,
mail is printed to the container log instead.

**Mount `/app/uploads`.** Item photos are written there, outside `public/` and outside the
image. Without a volume they live in the container's writable layer and vanish with it — and
`docker run --rm` on an upgrade would take every cover photo with it. `UPLOADS_DIR` already
points there in the image; override it only if you mount somewhere else.

### Origins: nothing to bake in, but do set `BETTER_AUTH_URL`

The image carries no origin, which is what lets one build run on `localhost:3000`, on a LAN
address, and behind a reverse proxy on a real domain. Nothing is compiled in: Better Auth
derives its base URL from the incoming request, and the links that have to be absolute —
share links, invite links — come from `requestOrigin()`, which prefers `x-forwarded-host` and
`x-forwarded-proto` and falls back to `Host`. Put it behind a proxy that forwards those and
the links come out right. (`src/lib/request-origin.test.ts` pins that precedence, including
that `localhost.evil.example` is not loopback.)

**`NEXT_PUBLIC_BETTER_AUTH_URL` does not exist any more, and setting it does nothing.**
Worth stating outright, because the failure is silent: `NEXT_PUBLIC_*` values are inlined
into the client bundle when the image is *built*, so passing one to `docker run` never had
any effect, and baking one in is precisely what would tie the image to one host. If you have
it in an older `.env` or copied a compose file from another Next.js project, drop it — the
Dockerfile takes no build arguments at all.

`BETTER_AUTH_URL` (no `NEXT_PUBLIC_`) is a different thing: it's read at runtime, so it works
on `docker run`, and it's worth setting to your public origin. Without it the app is fully
usable — sign-in, sign-up and everything else go through Server Actions, which don't consult
it — but two things change:

- Better Auth logs `Base URL is not set` at every boot. Harmless, and alarming in a log you
  are reading for some other reason.
- The `/api/auth/*` REST endpoints reject with `403 INVALID_ORIGIN`, because the origin
  allowlist Better Auth builds from `baseURL` is empty. Nothing in Asaph calls them — the UI
  is Server Actions throughout — so this only bites if you're scripting against them.
- [Password reset](#password-reset-by-email) isn't offered, even with mail set up. Its link
  is built from `BETTER_AUTH_URL` and nothing else, because building it from the request's
  host is how reset links get hijacked.

Set it and both go away:

```bash
-e BETTER_AUTH_URL=https://asaph.example.com
```

It's per-deployment and runtime-only, so it costs the image none of its portability.

### Architectures

`linux/amd64` only. Building arm64 would mean QEMU, and the emulated leg is the whole
Turbopack compile rather than just a native dependency download — five to ten times slower,
so twenty to forty minutes added to every release for demand nobody has expressed.
(`package-lock.json` lists `@img/sharp-linuxmusl-arm64`, but that isn't evidence of any: npm
records every platform's optional dependency in lockfile v3, and it lists ppc64, riscv64 and
s390x too.) If arm64 is wanted, the right shape is a matrix of native `ubuntu-24.04` and
`ubuntu-24.04-arm` runners merged by digest, not QEMU.

### Cutting a release

`package.json`'s version is hand-maintained, so a release is a version bump merged to main,
then a tag on that commit:

```bash
git tag v0.1.0 && git push origin v0.1.0
```

`release.yml` guards the tag rather than re-running the suite on a commit that already
passed: the tag must be `v*`, its version must match `package.json`, the commit must be an
ancestor of `main`, and `ci-required` must have concluded successfully for that exact SHA. It
then builds, pushes, and cuts a GitHub Release whose notes are generated from the merge
commits since the previous tag. `workflow_dispatch` against a tag re-publishes it.

The GHCR package is created **private** on the first publish and has to be made public by
hand, in the package's settings on GitHub. That's a one-time UI action, not something a
workflow can do for you.

## Scripts

| Command | Does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` / `npm run start` | Production build / serve |
| `npm test` | Unit and provider tests — needs no database, no network, no env (see below) |
| `npm run test:watch` | The same tests, re-running on change |
| `npm run test:db` | Integration tests against real Postgres — needs `docker compose up -d db` |
| `npm run test:coverage` | Coverage over the tested modules (runs all three Vitest tiers, so it needs the database too) |
| `npm run test:e2e` | Smoke tests in a browser against the standalone build — needs `npm run build` first |
| `npm run test:e2e:ui` | The same four specs in Playwright's UI mode, for writing or debugging one |
| `npm run db:generate` | Generate a Drizzle migration from schema changes |
| `npm run db:migrate` | Apply migrations |
| `npm run db:push` | Push schema directly (no migration file — dev convenience) |
| `npm run db:studio` | Drizzle Studio (browse the DB) |
| `npm run db:seed` | Seed the 15 built-in templates (idempotent) |
| `npm run db:seed -- --demo` | Same, plus the two demo accounts, their collections, and the sharing fixtures |
| `npm run lookup:check` | Prove the metadata cache spares the provider's free tier (see below) |
| `npm run covers:backfill` | Mirror already-matched items' provider covers (dry run; `-- --apply` writes) |
| `npm run email:test -- --address you@example.com` | Send one real test message through `sendEmail` (see [Sending email](#sending-email)) |

## Tests

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

### The unit tier

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

### The integration tier

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
because a hit and a miss return the same fields — see "Staying inside the free tier" below
for what it checks and how it divides labour with `npm run lookup:check`.

CI runs all of this as its own job against a `postgres:18-alpine` service container with no
secrets, and applies the migrations to an empty database as a separate step before any spec
runs — nothing else proves `drizzle/migrations/meta/_journal.json` is consistent with the
files beside it.

### The smoke tier

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

### Conventions

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

### Password reset by email

"Forgot password?" on `/auth` asks for an address and mails a link to `/auth/reset`, where
the person picks a new password. Both steps are Server Actions calling Better Auth's
`requestPasswordReset` and `resetPassword`, the same way `signUpAction` calls
`signUpEmail`, so nothing about tokens is reimplemented. The token lasts an hour and works
once. Setting a new password signs out **every** session the account had
(`revokeSessionsOnPasswordReset`), since a reset is often the answer to someone else being
signed in. The person then signs in with the new password, on this device too.

**Only offered when it can work: mail configured *and* `BETTER_AUTH_URL` set.** Without
both, `sendResetPassword` isn't passed to `betterAuth()`, so Better Auth's endpoint answers
`RESET_PASSWORD_DISABLED`, and `/auth` shows no link. That's the `ALLOW_SIGNUPS` rule again:
a feature that can't work shouldn't be something you find out about by filling in a form.
On such an instance the way back into a locked account is the operator, as it always was.
Like `disableSignUp`, it's decided once at startup.

**Why `BETTER_AUTH_URL`, when share and invite links use the request's own origin.**
`requestOrigin()` reads `Host` and `X-Forwarded-Host`, and whoever sends a request chooses
those. Suppose someone asks for a reset of *your* address with a forged host. A link built
from the request would put your live token on their domain, and one click hands them your
account. Invite links don't have this problem, because an invite token only works when
accepted by the account it names. A reset token *is* the account. So the origin has to come
from the operator, and `BETTER_AUTH_URL` is the variable they already set. Better Auth hands
`sendResetPassword` a ready-made `url` as well. That's ignored: it points at Better Auth's
own `/api/auth/reset-password/:token` redirect hop, and the page that takes the password is
ours. The Compose file sets `BETTER_AUTH_URL=http://localhost:3000`. Change it to your public
origin, or reset emails will send people to localhost.

**The same answer for every address.** "If that address has an account, a link is on its
way" whether it has one or not, whether the email was held back, and whether the send
failed. Anything else would make the form a way to find out who has an account. Better Auth
already answers an unknown address with its success message and simulates the lookup to
blunt timing differences. The action doesn't undo that on the way out. A failed send is
logged for the operator and never shown.

**One email a minute per address, on both entry points.** Better Auth rate-limits
`/request-password-reset` to 3 a minute, but that limiter only runs for HTTP requests to
`/api/auth/*`. A Server Action calls `auth.api.*` directly and never meets it. Without a
check of our own, anyone could make the instance send an unlimited stream of reset emails
to any address, spending the operator's send quota (Resend's free plan is 100 a day) and
flooding the inbox. The check is in `sendResetPassword` (`shouldSendReset` in
`src/db/queries/password-reset.ts`) rather than in the action, because that callback is the
one place both the action and the HTTP route pass through. By then Better Auth has written
the new token's row. If an earlier `reset-password:` row for the same user exists from the
last 60 seconds, nothing is sent and the new row is deleted, so the only live links are ones
somebody was actually sent. "Earlier" is by `createdAt`, then id. That way two overlapping
requests agree on which one sends. Counting *any* other row would have each hold the other
back, and a double-clicked button would send nothing. Deleting held-back rows keeps the
window anchored to the last email that went out, so a loop of requests gets one email a
minute through rather than locking the real owner out for as long as it runs.

Not here: changing an email address, email verification, an admin-initiated reset, and a
general IP-based limiter for Server Actions. A reset signs out every session, but a device's
five-minute session cookie cache (`session.cookieCache`) can still read as signed in until
it lapses. The same is true of "Sign out everywhere".

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

### Invites are emailed, and their links can be copied

Inviting someone from the Sharing card writes the membership row and then mails the
invitee: who invited them, to which collection, whether they can view or edit, the link,
and that it expires in 14 days. The link is absolute and built from `requestOrigin()`,
like a share link and for the same reason: the image has no origin of its own. The 14 is
`INVITE_TTL_DAYS` in `src/db/queries/members.ts`, the same constant `acceptInvite`
checks, so the email can't promise a window the server doesn't keep.

**A failed send keeps the invite.** The row is a working invite whether or not mail went
out, so an SMTP outage doesn't roll it back. That would throw away something that works
and make the owner start over. `inviteMemberAction` returns what happened to the email
(`sent`, `not_configured` or `failed`) and the card says which. "Failed" logs the SMTP
error for the operator and tells the owner to copy the link instead. "Not configured"
says the instance doesn't send mail, which is the truth on most self-hosted installs.

**Every pending invite has a Copy invite link button**, mail or no mail. It's how sharing
works on an instance without SMTP, and the way round a spam folder or a mistyped address.
The URL is built on the server, as `shareUrl` is. The page is owner-only, so showing the
token there exposes nothing the owner couldn't already mint. An expired invite shows
"Expired" and no button, because copying a dead link helps nobody.

**Resending is inviting again.** `inviteMember` upserts on (collection, email). For a
pending invite that mints a new token, restarts the 14 days and takes the role asked for
this time, so the old link dies and the new email carries the only one that works.

**Inviting someone who has already accepted does nothing.** The same upsert used to set
`acceptedAt` back to null. `resolveRole` requires it, so typing a member's address in
again silently revoked their access until they accepted again. With invites sending mail
that would have become "they lost access and got an email". The upsert now carries
`setWhere: isNull(acceptedAt)`, so an accepted row is left exactly as it was and comes
back with `acceptedAt` set. The action sends nothing and the card says they already have
access. Role changes have their own control in the member list. The skip is part of the
`INSERT … ON CONFLICT` rather than a read before the write, so an accept landing between
the two can't slip past it.

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

## Sending email

Asaph sends mail over SMTP through one function, `sendEmail({ to, subject, text, html })`,
in `src/lib/email/`. Nothing else in the app touches nodemailer, so a test swaps the
transport at that seam and an HTTP-API provider, if one is ever wanted, changes that one
directory. Collection invites are sent through it (see
[Invites are emailed, and their links can be copied](#invites-are-emailed-and-their-links-can-be-copied)).
So is [password reset](#password-reset-by-email). Better Auth's verification hook is the one call site still printing
a `[dev email stub]` line.

**It's optional.** With `SMTP_HOST` or `EMAIL_FROM` unset, `emailConfigured()` is false
and `sendEmail` prints the message, links included, to the server console instead of
sending it. That's what the stubs have always done, so existing instances and local dev
need no new configuration. It matters because this image is run by people who will never
set up mail.

| Variable | |
| --- | --- |
| `SMTP_HOST` | The server. Required to send. |
| `SMTP_PORT` | Default `587`. `465` means implicit TLS; see below. |
| `SMTP_USER` / `SMTP_PASSWORD` | Both or neither. Neither means no `AUTH`, for a relay that wants none. |
| `EMAIL_FROM` | The sender, `addr@example.com` or `Asaph <addr@example.com>`. Required to send. |

**Discrete variables, not an `SMTP_URL`.** A URL was the first design. It was dropped
because SMTP passwords are whatever the provider issues, and some issue ones a URL can't
hold as-is: an Amazon SES SMTP password is base64, so it can contain `/` and `+`. Inside a
URL those need percent-encoding, and forgetting to encode one doesn't produce a config
error. It produces an authentication failure indistinguishable from a wrong password.
Separate variables leave nothing to encode, so switching providers is a change of values,
never of format. Values are trimmed, because a stray space after the `=` fails the same
way. A value that is set but can't work, such as a non-numeric port or a password with no
user, throws an error naming the variable. It doesn't fall back to the console: someone
who set mail up should hear that it's broken, not find links in a log.

**SMTP rather than a vendor SDK.** The published image runs wherever someone deploys it,
and SMTP is the one protocol every provider speaks: Resend, Brevo, Postmark, SES,
Fastmail, a home relay. An SDK would tie the image to whichever vendor we picked. That has
already paid off once. The first plan was Azure Communication Services, and Microsoft
announced the retirement of its email service (30 September 2028) while this transport
was being built. Moving to Resend changed values in `.env`, not code.

**TLS is required, and the port decides how.** Port `465` is implicit TLS. Any other port
must upgrade with STARTTLS, and a server that doesn't offer it is an error, not a
plaintext send. nodemailer's default is to use STARTTLS *if advertised*, which is exactly
what a downgrade attack exploits: strip the advertisement and the client carries on in
the clear, with invite and reset tokens in the body. The one exception is a **loopback**
host (`localhost`, `127.0.0.1`, `::1`). There Asaph sends plaintext and doesn't attempt
STARTTLS, since the traffic never leaves the machine. That's what lets Mailpit work
below, and it's right for a production relay on localhost too, whose certificate is
usually self-signed. `localhost.evil.example` is not loopback.

**Sends are awaited, and they throw.** The transport doesn't decide what a failure means.
A failed invite should keep the invite and say so; a failed reset should look like any
other reset request. Each caller decides, so there's no queue and no retry here. Timeouts
are 10s to connect, 10s for the greeting and 20s of silence, down from nodemailer's two
minutes and ten. A send runs inline with someone's click, and a server that accepts the
connection and then goes quiet shouldn't hold that click for minutes.

### Seeing mail locally with Mailpit

`docker-compose.yml` has an optional [Mailpit](https://mailpit.axllent.org/) service
behind a profile, so a plain `docker compose up` never starts it:

```bash
docker compose --profile mail up -d mailpit
```

Then set `SMTP_HOST=localhost`, `SMTP_PORT=1025` and any `EMAIL_FROM` in `.env.local`,
restart `npm run dev`, and read what was sent, rendered, at
[localhost:8025](http://localhost:8025). Both ports are published on loopback only.

This is for `npm run dev` on the host. **The containerized `app` service can't use it.**
From inside that container Mailpit is `mailpit:1025`, which isn't loopback, so STARTTLS
is required. Mailpit only offers STARTTLS when given a certificate, and the app would
then have to be told to trust it. Adding a "TLS off" switch to make that work would be a
switch a self-hoster could also leave set in production.

### Resend

Asaph's own deployment sends through [Resend](https://resend.com), over SMTP rather than
its SDK, for the reason above. Setup, per Resend's
[SMTP guide](https://resend.com/docs/send-with-smtp):

1. In the Resend dashboard, add your domain, create the SPF and DKIM records it shows,
   and wait for **Verified**. Resend suggests a subdomain (`mail.example.com`) so the
   sending reputation stays separate from your main domain.
2. Create an API key with **Sending access**, restricted to that domain. SMTP only
   sends, so a **Full access** key would only add risk if it leaked.

```bash
SMTP_HOST=smtp.resend.com
SMTP_PORT=465
SMTP_USER=resend
SMTP_PASSWORD=re_...   # the API key
EMAIL_FROM=Asaph <asaph@mail.example.com>
```

`465` is implicit TLS. `587` (STARTTLS) works just as well. If your host blocks both, as
some cloud providers do for outbound mail on new accounts, use **`2587`** (STARTTLS).
Don't use `2465`: it's implicit TLS on a port Asaph doesn't recognise as such, so Asaph
would wait for a plaintext greeting that never comes and time out after 10 seconds.

To check the setup end to end before anything depends on it, send yourself one message:

```bash
npm run email:test -- --address you@example.com
```

It goes through `sendEmail`, the same path invites and resets take. It prints the server,
TLS mode and SMTP user it used, and exits non-zero if mail isn't configured, since the
console fallback would otherwise make it "pass" without sending anything. Each run counts
against the quota below.

Three things that will otherwise look like bugs:

- **Without a verified domain, nothing reaches anyone else.** Sending from
  `onboarding@resend.dev` only delivers to your Resend account's own address, and any
  other recipient is rejected with "You can only send testing emails to your own email
  address"
  ([details](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain)). That's
  fine for a first test and useless for invites. `EMAIL_FROM` has to be on the domain
  from step 1.
- **The free plan allows 100 emails a day and 3,000 a month**, and the day is a UTC
  calendar day. Every account is also limited to 10 requests a second, which Resend
  applies to SMTP the same as to its API
  ([quotas](https://resend.com/docs/knowledge-base/account-quotas-and-limits)). The
  101st invite of the day is a quota, not a bug.
- **The password is the API key.** Revoking or rotating the key in the dashboard breaks
  sending with an authentication error, even though nothing in Asaph changed.

## MySQL path (not built, but the seam is here)

`src/db/schema/*` and `src/db/client.ts` are the only DB-coupled modules; `src/db/queries/*`
is plain async functions everything else calls. To target MySQL: swap
`drizzle-orm/node-postgres` → `drizzle-orm/mysql2`, `jsonb` columns → `json` (validate shape
in the API layer instead of Postgres check constraints), replace the `jsonb_path_ops` GIN
index with per-field generated+indexed columns, and swap `gen_random_uuid()` for
app-generated UUIDs (MySQL has no native equivalent).
