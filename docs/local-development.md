# Local development

Running Asaph from a checkout, for working on it. To run the published image instead, see
[Self-hosting](self-hosting.md).

Requires Node 20.9+ (the floor Next.js 16 enforces) and Docker. The container image builds
on `node:24-alpine`, so 24 is the version to match if you want local dev and Docker aligned.

## First-time run

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
   instead, see [Seeing mail locally with Mailpit](email.md#seeing-mail-locally-with-mailpit).

   `ALLOW_SIGNUPS` is optional too and defaults to open. Don't set it to `false`
   yet — see [Closing registration](self-hosting.md#closing-registration), which needs an
   account to exist first.

   Every variable is listed in the [configuration reference](self-hosting.md#configuration).

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

5. **Demo data (optional).** See [Demo data](#demo-data) below.

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

## Demo data

Creates two demo accounts, four populated collections, and the membership rows that make
sharing testable without setting it up by hand:

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

The demo password is published here, so never leave these accounts on an instance anyone
else can reach without changing it first.

## Scripts

| Command | Does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` / `npm run start` | Production build / serve |
| `npm test` | Unit and provider tests — needs no database, no network, no env (see [Testing](testing.md)) |
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
| `npm run lookup:check` | Prove the metadata cache spares the provider's free tier (see [Staying inside the free tier](design/metadata.md#staying-inside-the-free-tier)) |
| `npm run covers:backfill` | Mirror already-matched items' provider covers (dry run; `-- --apply` writes — see [Cover art is copied, not hotlinked](design/metadata.md#cover-art-is-copied-not-hotlinked)) |
| `npm run email:test -- --address you@example.com` | Send one real test message through `sendEmail` (see [Sending email](email.md)) |

## Changing the schema or a template

Schema changes go through `npm run db:generate`, which writes a migration into
`drizzle/migrations/` to be committed alongside the change. `db:push` is a local convenience
that leaves no migration behind, so nothing it does can reach another database.

A template change needs `npm run db:seed` to take effect, and only reaches collections
created afterwards: existing shelves keep the columns they were made with, so adding a field
to one is a manual custom-field add.
