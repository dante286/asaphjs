# Asaph

A self-hostable collection tracker for games, books, manga, movies, records, LEGO or anything
else you shelve. It's built on one generic schema rather than a table per hobby: a collection
carries its own field definitions, so a new kind of collection is a template, not a
migration. It replaces a 13-table Oracle APEX app.

- **Collections** from 14 built-in templates, a blank start, or a CSV, each with its own
  custom fields.
- **Per-field autosave** in a covers grid or a table, optimistic, with conflict detection
  when two people edit the same item.
- **CSV import** into a new or existing collection, with type guessing, column mapping, and
  an undo for the whole import.
- **Metadata lookups** against IGDB (games), Open Library (books, comics, manga) and TMDB
  (movies, TV, anime), which fill blank fields only and copy cover art locally.
- **Sharing** through per-collection invites with viewer or editor roles, emailed when mail
  is set up, and public read-only links that can be rotated.
- **Accounts** with email and password, password reset by email, session management, CSV and
  JSON export, and account deletion. Registration can be closed for a private instance.
- **Item photos**, re-encoded to WebP with their location metadata stripped.

## Stack

Next.js 16 (App Router, TypeScript), PostgreSQL via Drizzle ORM, Better Auth, and TanStack
Query for the item grid's autosave. Everything else is Server Components and Server Actions.
It ships as one `linux/amd64` container image. See [Architecture](docs/architecture.md).

## Quickstart

Requires Node 20.9+ (24 matches the container image) and Docker.

```bash
npm install
cp .env.example .env.local
```

Set `BETTER_AUTH_SECRET` in `.env.local` to the output of `openssl rand -base64 32`. Nothing
else needs to change for local development. Then start Postgres, create the schema, seed the
templates and demo data, and run the dev server:

```bash
docker compose up -d db
npm run db:migrate
npm run db:seed -- --demo
npm run dev
```

Open [localhost:3000](http://localhost:3000) and sign in as `demo@example.com` with
`demopassword123`. [Local development](docs/local-development.md) covers each step, the demo
accounts and sharing fixtures, and every npm script.

### Running the published image

Each release is published to
[`ghcr.io/dante286/asaphjs`](https://github.com/dante286/asaphjs/pkgs/container/asaphjs). The
image needs a Postgres that has already been migrated and seeded from a checkout, and a
volume for item photos:

```bash
docker run -d --name asaph -p 3000:3000 \
  -e DATABASE_URL=postgresql://postgres:mysecretpassword@host.docker.internal:5432/asaph \
  -e BETTER_AUTH_SECRET=<a fixed secret> \
  -e BETTER_AUTH_URL=http://localhost:3000 \
  -v asaph-uploads:/app/uploads \
  ghcr.io/dante286/asaphjs:0.1.0
```

[Self-hosting](docs/self-hosting.md) has the configuration reference, reverse proxy setup,
backups, upgrades and troubleshooting.

## Documentation

| | |
| --- | --- |
| [User guide](docs/user-guide.md) | Using Asaph: collections, items, lookups, import, sharing, your account |
| [Self-hosting](docs/self-hosting.md) | Running the image, environment variables, closing registration, operations |
| [Sending email](docs/email.md) | SMTP configuration, Mailpit locally, Resend |
| [Local development](docs/local-development.md) | Setup from a checkout, demo data, scripts |
| [Architecture](docs/architecture.md) | Stack, code layout, data model, dependency notes |
| [Testing](docs/testing.md) | The four test tiers and their conventions |
| [Releasing](docs/releasing.md) | Cutting a release, supported architectures |
| [Design notes](docs/index.md#design-notes) | Why accounts, collection URLs, sharing, lookups and uploads work the way they do |

The design notes are where this project keeps its reasoning: the alternatives considered and
what was deliberately left out. A feature ships with its note.

## Not built yet

MusicBrainz and Rebrickable metadata providers; the provider interface already takes them.
MySQL support; the schema layer is isolated for it, as
[Architecture](docs/architecture.md#mysql-path-not-built-but-the-seam-is-here) describes.
