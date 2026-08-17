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
   nothing else needs to change for local dev.

3. **Database.** Any Postgres 14+ works; Postgres 18 is the tested/recommended version.
   Easiest is the `db` service already defined in `docker-compose.yml`:

   ```bash
   docker compose up -d db
   ```

   (Standalone `docker run` also works — see the `db` service definition for the
   equivalent flags. Postgres 18+ images expect their volume mounted at
   `/var/lib/postgresql`, not the older `/var/lib/postgresql/data`.)

4. **Migrate + seed.** `db:migrate` creates the schema; `db:seed` inserts the 14 built-in
   templates (13 collection types plus "Blank"):

   ```bash
   npm run db:migrate
   npm run db:seed
   ```

   Both read `DATABASE_URL` from `.env.local` — not `.env`, which Compose reads separately.
   A `DATABASE_URL` already set in your shell takes precedence over the file. If the
   database it points at doesn't exist, these fail with `database "<name>" does not exist`
   and leave you with no tables — check the database name in the URL first.

   Both commands work from any shell (bash, PowerShell, cmd) and are safe to rerun —
   templates upsert by key rather than duplicating.

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
   reads that separately):

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
| `npm run db:seed` | Seed the 14 built-in templates (idempotent) |
| `npm run db:seed -- --demo` | Same, plus the demo account and its three collections |

## What's implemented

Auth (email/password), collections with template/blank/CSV creation, custom fields,
per-field autosave (covers + table views, optimistic with conflict detection), CSV import
into new or existing collections (type-guessing, mapping, batch rollback), sharing
(per-collection invites with viewer/editor roles, public read-only links), account settings
(profile, password, sessions, CSV/JSON export), and photo upload for item covers.

**Not implemented:** real metadata/cover lookups (IGDB/OpenLibrary/TMDB/etc.) — stubbed
behind `src/lib/metadata/provider.ts`'s interface only, since those need third-party API
keys.

## Item photos

Covers come from a metadata provider when one has art, and otherwise from a photo the
owner uploads on the item detail page (JPEG/PNG/WebP/GIF/AVIF, 10MB cap). Files land in
`UPLOADS_DIR` (default `./uploads`, a Docker volume in Compose) — no S3/R2 wiring.

Nothing is stored as sent. `src/lib/uploads/store.ts` re-encodes every upload through
sharp: EXIF orientation applied, then bounded to 1600px on the longest edge and written
as WebP. That caps what a 4000px phone photo costs to serve, drops the EXIF block (a
camera roll photo carries GPS coordinates), and means the bytes on disk are libvips
output rather than a stranger's file. Animated GIFs keep their first frame only.

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
