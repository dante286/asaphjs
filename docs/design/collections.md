# Collection URLs

A collection lives at `/collections/:slug`, where the slug is derived from its name. These
are the decisions behind how that slug is minted, kept unique, and changed.

## Renaming moves a collection's URL

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

## Slugs are unique across the table, not per owner

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
