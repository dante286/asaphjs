# Architecture

Asaph replaces a 13-table Oracle APEX app, one table per hobby, with **one generic schema**.
A collection carries its own field definitions and an item stores its values against them, so
a new kind of collection is a template row rather than a migration. This page is the map of
how the code is laid out and the decisions that cut across it. The feature-level reasoning is
under [Design notes](index.md#design-notes).

## Stack

- **Next.js 16** (App Router, TypeScript) — route handlers under `src/app/api/**` are the API layer.
- **PostgreSQL** via **Drizzle ORM** (`src/db`). MySQL isn't wired up, but the schema/client
  layer is isolated enough to swap later — see [MySQL path](#mysql-path-not-built-but-the-seam-is-here).
- **Better Auth** for email/password auth, sessions stored in Postgres.
- **TanStack Query** for the item grid's optimistic per-field autosave; everything else is
  Server Components + Server Actions.
- **sharp** for re-encoding uploaded photos and mirrored cover art; **nodemailer** for SMTP.
- The "Industry" design system (blueprint/hairline-corner motif) is vendored verbatim in
  `src/app/design-system.css`.

## Where things live

| Path | Holds |
| --- | --- |
| `src/app/(app)/**`, `src/app/(auth)/**` | Pages, as Server Components — the dashboard, collections, items, `/account`, `/auth` |
| `src/app/s/[token]`, `src/app/invite/[token]` | The public share page and invite acceptance, reachable signed out |
| `src/app/api/**` | Route handlers: items, photos, view preferences, lookups, uploads, exports |
| `src/actions/**` | Server Actions: auth, account, collections, imports, members, metadata |
| `src/db/queries/**` | Plain async functions, and the only place SQL lives |
| `src/db/schema/**`, `src/db/client.ts` | Drizzle table definitions and the one module-level pool |
| `src/lib/metadata/**` | Provider registry, cache, rate limiter, prefill planning, cover mirroring |
| `src/lib/uploads/**` | The sharp pipeline, filename rules, URL derivation |
| `src/lib/email/**` | `sendEmail` and the messages built on it |
| `src/components/**` | React components, by area |
| `middleware.ts` | Sends visitors with no session cookie on `/`, `/collections/**` and `/account/**` to `/auth`. A cookie-presence check only; authorization happens per request |
| `scripts/**` | Seeding, `lookup:check`, `covers:backfill`, `email:test`, the e2e server |

Rules live in `src/db/queries/`, not in the routes or actions that call them. Cover files are
swept by `deleteItem`, `deleteCollection` and `deleteUploadsForOwner`; slugs are regenerated
by `updateCollectionSettings()`. Putting them there means the next caller can't forget them.

## Data model

| Table | Is |
| --- | --- |
| `templates` | The 15 built-in field sets (owner `null`), seeded by `npm run db:seed` and upserted by key |
| `collections` | Owner, name, slug, its own copy of the field definitions (`fields`, jsonb), default view, `features` (including which lookup provider it uses), and the public link's `share_token`/`share_enabled` |
| `items` | `title`, `cover_url`, `verified`, `borrower`, `lent_on` and `notes` as real columns; every other field in `values` (jsonb, with a `jsonb_path_ops` GIN index); `external_ref` for a metadata match; a generated `sort_title` |
| `collection_members` | Invites and memberships: address, role, invite token, inviter, accepted-at |
| `import_batches` | One per CSV import, which is what "Undo this import" rolls back |
| `view_preferences` | Per-user column widths and hidden columns, per collection |
| `lookup_lists`, `lookup_values` | Option lists for select fields (consoles, regions). In the schema, but nothing reads them yet |
| `metadata_cache`, `metadata_search_cache` | Provider responses by source id and by normalized query |
| `user`, `session`, `account`, `verification` | Better Auth's own tables |

Templates are copied, not linked. `createCollection()` copies a template's field definitions
onto the new collection row, so changing a template later never reshapes a collection someone
already built. Deleting a user cascades to their collections and on to the items, which is
why the uploads sweep has to run first — see
[Deleting an account sweeps its uploads first](design/accounts.md#deleting-an-account-sweeps-its-uploads-first).

## Autosave and edit conflicts

The item grid saves one field at a time, optimistically. `patchItem` compares the client's
`updatedAt` with the row's and the API answers 409 on a mismatch, which `ConflictError` in
`src/lib/api/items-client.ts` turns into the conflict UI. The merge itself is a raw jsonb
`||` / `- text[]` expression inside a transaction that takes `FOR UPDATE`. The
[demo data](local-development.md#demo-data) has the two accounts needed to see it.

## A read-only view is a view with no handlers

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

## Dependencies worth knowing about

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

### Dependabot stays on Node 24

Dependabot watches npm, GitHub Actions, the Dockerfile and the Compose file, but ignores
Node's major versions. The odd-numbered majors are never LTS, and moving to an even one is a
deliberate decision, made together with the `node-version` lines in `ci.yml` and the Node
version the docs ask for — which Dependabot can't see. `.github/dependabot.yml` has the
reasoning.

## MySQL path (not built, but the seam is here)

`src/db/schema/*` and `src/db/client.ts` are the only DB-coupled modules; `src/db/queries/*`
is plain async functions everything else calls. To target MySQL: swap
`drizzle-orm/node-postgres` → `drizzle-orm/mysql2`, `jsonb` columns → `json` (validate shape
in the API layer instead of Postgres check constraints), replace the `jsonb_path_ops` GIN
index with per-field generated+indexed columns, and swap `gen_random_uuid()` for
app-generated UUIDs (MySQL has no native equivalent).
