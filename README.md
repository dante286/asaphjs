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

Requires Node 20.9+ and Docker.

1. **Install:**

   ```bash
   npm install
   ```

2. **Env vars.** Copy `.env.example` to `.env.local` and generate a `BETTER_AUTH_SECRET`
   (`openssl rand -base64 32`). Defaults for `DATABASE_URL` already match step 3 below, so
   nothing else needs to change for local dev.

3. **Database.** Any Postgres 14+ works; Postgres 18 is the tested/recommended version.
   Easiest is the `db` service already defined in `docker-compose.yml`:

   ```bash
   docker compose up -d db
   ```

   (Standalone `docker run` also works — see the `db` service definition for the
   equivalent flags. Postgres 18+ images expect their volume mounted at
   `/var/lib/postgresql`, not the older `/var/lib/postgresql/data`.)

4. **Migrate + seed.** Applies the schema, then seeds the 13 built-in templates plus
   (with `--demo`) a demo account with three populated collections:

   ```bash
   npm run db:migrate
   npm run db:seed -- --demo
   # Demo login: demo@example.com / demopassword123
   ```

   > **Windows/PowerShell:** `npm run db:seed` fails with `'DOTENV_CONFIG_PATH' is not
   > recognized` — the script's inline `VAR=value cmd` syntax is bash-only, and `npm run`
   > shells out to `cmd.exe` on Windows. Run it directly instead:
   >
   > ```powershell
   > $env:DOTENV_CONFIG_PATH = ".env.local"
   > npx tsx -r dotenv/config scripts/seed/run.ts --demo
   > ```

5. **Run:**

   ```bash
   npm run dev
   ```

   Or fully containerized instead of steps 1/5 — build and run the app itself in Docker
   too (still needs steps 2–4 for the database; copy `BETTER_AUTH_SECRET` from
   `.env.local` into a top-level `.env` file first, since Compose reads that separately):

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
| `npm run db:seed -- [--demo]` | Seed templates, optionally demo data |

## What's implemented

Auth (email/password), collections with template/blank/CSV creation, custom fields,
per-field autosave (covers + table views, optimistic with conflict detection), CSV import
into new or existing collections (type-guessing, mapping, batch rollback), sharing
(per-collection invites with viewer/editor roles, public read-only links), account settings
(profile, password, sessions, CSV/JSON export).

**Not implemented:** real metadata/cover lookups (IGDB/OpenLibrary/TMDB/etc.) — stubbed
behind `src/lib/metadata/provider.ts`'s interface only, since those need third-party API
keys. Cover images are user-supplied URLs or local `public/uploads/` — no S3/R2 wiring.

## MySQL path (not built, but the seam is here)

`src/db/schema/*` and `src/db/client.ts` are the only DB-coupled modules; `src/db/queries/*`
is plain async functions everything else calls. To target MySQL: swap
`drizzle-orm/node-postgres` → `drizzle-orm/mysql2`, `jsonb` columns → `json` (validate shape
in the API layer instead of Postgres check constraints), replace the `jsonb_path_ops` GIN
index with per-field generated+indexed columns, and swap `gen_random_uuid()` for
app-generated UUIDs (MySQL has no native equivalent).
