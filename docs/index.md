# Asaph documentation

Asaph is a self-hostable collection tracker built on one generic schema. The
[README](https://github.com/dante286/asaphjs#readme) has the overview and a quickstart; these
pages have everything else.

## Using Asaph

- [User guide](user-guide.md): collections, items, lookups, CSV import, sharing, and your
  account.

## Running Asaph

- [Self-hosting](self-hosting.md): the published image, every environment variable, reverse
  proxies, closing registration, backups, upgrades and troubleshooting.
- [Sending email](email.md): SMTP setup, why it's plain SMTP, Mailpit for local work, and
  Resend.

## Working on Asaph

- [Local development](local-development.md): first run from a checkout, demo data, and the
  npm scripts.
- [Architecture](architecture.md): the stack, where code lives, the data model, and the
  cross-cutting decisions.
- [Testing](testing.md): the four test tiers, what each one exists to catch, and the
  conventions.
- [Releasing](releasing.md): cutting a release and why the image is `linux/amd64` only.

## Design notes

Why features behave the way they do: the alternatives considered, what a provider or library
forced, and what was deliberately left out. A feature ships with its design note.

- [Accounts and sign-in](design/accounts.md): closing registration, password reset by email,
  and what deleting an account sweeps up.
- [Collection URLs](design/collections.md): why renaming moves a URL, and why slugs are unique
  across the whole instance.
- [Sharing](design/sharing.md): public links that keep their address, rotation, and emailed
  invites.
- [Metadata lookups](design/metadata.md): IGDB, Open Library and TMDB, conservative autofill,
  cover mirroring, and staying inside free tiers.
- [Item photos](design/uploads.md): the sharp pipeline, thumbnails, and where uploads live.
