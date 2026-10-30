# Self-hosting

Running an Asaph instance from the published container image. To work on the code, see
[Local development](local-development.md) instead; for how releases are made, see
[Releasing](releasing.md).

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
[Architectures](releasing.md#architectures).

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
[Origins](#origins-nothing-to-bake-in-but-do-set-better_auth_url). Everything else is in the
[configuration reference](#configuration) below.

**Generate the secret once and keep it.** `$(openssl rand -base64 32)` above makes a new one
on every `docker run`, and a new secret signs everyone out. Store it with the rest of the
instance's configuration and pass the same value on every start.

**Mount `/app/uploads`.** Item photos are written there, outside `public/` and outside the
image. Without a volume they live in the container's writable layer and vanish with it — and
`docker run --rm` on an upgrade would take every cover photo with it. `UPLOADS_DIR` already
points there in the image; override it only if you mount somewhere else.

## Configuration

All configuration is environment variables, read at runtime. [`.env.example`](https://github.com/dante286/asaphjs/blob/main/.env.example)
carries the same list with comments.

| Variable | Default | |
| --- | --- | --- |
| `DATABASE_URL` | — | **Required.** Postgres connection string. |
| `BETTER_AUTH_SECRET` | — | **Required.** Signs sessions. `openssl rand -base64 32`. |
| `BETTER_AUTH_URL` | unset | Your public origin. Optional, but password reset needs it — see [Origins](#origins-nothing-to-bake-in-but-do-set-better_auth_url). |
| `ALLOW_SIGNUPS` | open | Only the literal `false` closes registration. See [Closing registration](#closing-registration). |
| `UPLOADS_DIR` | `./uploads` (`/app/uploads` in the image) | Where item photos are written. Mount a volume here. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM` | unset, port `587` | Outgoing mail. Without `SMTP_HOST` and `EMAIL_FROM`, mail is printed to the log. See [Sending email](email.md). |
| `IGDB_CLIENT_ID` / `IGDB_CLIENT_SECRET` | unset | Video game lookups. Register an app at [dev.twitch.tv/console](https://dev.twitch.tv/console). |
| `TMDB_API_KEY` | unset | Movie, TV and anime lookups. Either credential from [themoviedb.org/settings/api](https://www.themoviedb.org/settings/api) works. |
| `METADATA_USER_AGENT` | `AsaphJS/0.1` | Identifies the instance to Open Library, per its API etiquette. Put a contact address in it. |

Without the provider keys, collections of those types simply show no metadata panel. Open
Library needs no key, so book, comic, manga and strategy guide lookups always work. See
[Metadata lookups](design/metadata.md).

A change to any of them needs a restart. `ALLOW_SIGNUPS`, and whether password reset is
offered, are decided once when the server starts.

## Origins: nothing to bake in, but do set `BETTER_AUTH_URL`

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
it — but three things change:

- Better Auth logs `Base URL is not set` at every boot. Harmless, and alarming in a log you
  are reading for some other reason.
- The `/api/auth/*` REST endpoints reject with `403 INVALID_ORIGIN`, because the origin
  allowlist Better Auth builds from `baseURL` is empty. Nothing in Asaph calls them — the UI
  is Server Actions throughout — so this only bites if you're scripting against them.
- [Password reset](design/accounts.md#password-reset-by-email) isn't offered, even with mail
  set up. Its link is built from `BETTER_AUTH_URL` and nothing else, because building it from
  the request's host is how reset links get hijacked.

Set it and all three go away:

```bash
-e BETTER_AUTH_URL=https://asaph.example.com
```

It's per-deployment and runtime-only, so it costs the image none of its portability. The
Compose file sets it to `http://localhost:3000`; change that to your public origin, or reset
emails will send people to localhost.

## Closing registration

`ALLOW_SIGNUPS=false` closes registration: the "Create account" segment disappears from
`/auth` and the sign-up API answers 400 `EMAIL_PASSWORD_SIGN_UP_DISABLED`. It's the switch
for running Asaph for one person or a household on a URL anyone can reach. Set it in
`.env.local` for local dev, or the top-level `.env` for Compose, and restart the server.

Only the literal `false` closes signups. Unset, empty, or a typo (`fasle`, `no`, `0`) leaves
them open — [Accounts and sign-in](design/accounts.md#closing-registration-on-an-instance)
explains why it fails open.

**Create your account before you close registration.** A fresh deployment with
`ALLOW_SIGNUPS=false` and an empty `user` table has no way in at all — no first-run bootstrap,
no admin CLI. Sign up first, confirm you can sign in, *then* flip the flag and restart. If you
seeded with `npm run db:seed -- --demo`, the `demo@example.com` account already exists and is
a usable way in, so a demo instance can be closed straight away — change its password first,
since the seed's is published in these docs.

**Letting someone in without opening registration.** With signups closed, `/account` has an
**Invite someone** card: enter an address, and Asaph emails it a link that lets that address
create an account, once, within 14 days. Anyone signed in can invite, up to five pending
invites each. The card only appears when it can work: mail configured *and*
`BETTER_AUTH_URL` set, since the link is built from it and is only proof of the inbox because
it was emailed — there's no copy-link fallback. Without mail, the way to add someone is still
to open registration, let them sign up, and close it again.
[Accounts and sign-in](design/accounts.md#inviting-someone-to-register) has the details.

Collection invites (from Sharing) are separate, and still need an account: on a closed
instance, someone you share a collection with needs a registration invite first.

## Password reset

"Forgot password?" appears on `/auth` only when the instance can deliver it: mail configured
*and* `BETTER_AUTH_URL` set. Without both, the link isn't shown and the way back into a
locked account is the operator. [Accounts and sign-in](design/accounts.md#password-reset-by-email)
has the details, including the one-email-a-minute limit per address.

## Backups

Two things hold an instance's data, and a backup needs both:

- **The Postgres database.** Every account, collection, item and setting. `pg_dump` it.
- **The uploads volume.** Item photos and mirrored cover art are files on disk, not rows.
  A database restored without them shows every local cover as a broken image.

## Upgrading

1. Read the release notes for the new version, and look for a migration.
2. If there is one, run `npm run db:migrate` (and `npm run db:seed`, which is idempotent)
   from a checkout of that version against the same database.
3. Pull the new tag and recreate the container, **with the same uploads volume** and the
   same `BETTER_AUTH_SECRET`.

## Maintenance commands

These run from a checkout pointed at the instance's database, not inside the container.

- `npm run covers:backfill` mirrors covers that are still hotlinked from a provider. It's a
  dry run unless passed `--apply`, and narrows with `--collection=<slug>`, `--host=<host>` and
  `--limit=<n>`. See [Cover art is copied, not hotlinked](design/metadata.md#cover-art-is-copied-not-hotlinked).
- `npm run lookup:check -- tmdb "dune"` checks a provider and the cache against the real API,
  with your real credentials. It's the thing to reach for when lookups misbehave on a live
  instance. See [Staying inside the free tier](design/metadata.md#staying-inside-the-free-tier).
- `npm run email:test -- --address you@example.com` sends one real message through the same
  path invites and resets take. See [Sending email](email.md#resend).

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `database "<name>" does not exist` on migrate or seed | The database named in `DATABASE_URL` doesn't exist. A `DATABASE_URL` exported in your shell overrides `.env.local`. |
| Cover photos gone after recreating the container | `/app/uploads` wasn't on a volume. |
| `Base URL is not set` in the log at boot | `BETTER_AUTH_URL` is unset. Harmless, but set it. |
| `403 INVALID_ORIGIN` from `/api/auth/*` | Same cause. |
| No "Forgot password?" link on `/auth` | Mail isn't configured, or `BETTER_AUTH_URL` is unset. Both are needed. |
| Reset emails link to `localhost` | `BETTER_AUTH_URL` is still the Compose default. |
| Share and invite links point at the wrong host | The proxy isn't forwarding `x-forwarded-host` and `x-forwarded-proto`. |
| Registration still open with `ALLOW_SIGNUPS` set | It must be the literal `false`, and the server must be restarted after changing it. |
| No metadata panel on a collection | That template has no provider, or this instance has no key for it. Intentional. |
| Mail appears in the log instead of being sent | `SMTP_HOST` or `EMAIL_FROM` is unset. |
| Every user signed out after a restart | `BETTER_AUTH_SECRET` changed between starts. |
