<!--
Title: an imperative sentence describing the change, not a ticket number —
"Add TMDB as a metadata provider", "Mirror TMDB covers instead of hotlinking them".

Sections you don't need, delete. An empty heading is worse than a missing one.
-->

## What

<!-- What was wrong or missing before this, and what the branch does about it. -->

## How

<!--
The decisions a reviewer can't read off the diff. This repo's PRs carry their
rationale: why this shape and not the obvious alternative, what a provider or
library actually returns that forced the approach, what was deliberately NOT
abstracted. If a choice looks arbitrary in the diff, explain it here.
-->

## What this doesn't do

<!--
Deliberate omissions, so they don't read as oversights: data a provider can't
fill, cases left for a later pass, fields intentionally never auto-written.
-->

## Verification

<!--
What you actually ran, with results — not what you intend to run. Name the
commands and paste the counts/values that matter. If something was only checked
at the layer below the UI, say so rather than implying an end-to-end run.
-->

- [ ] `npx tsc --noEmit` clean
- [ ] `npm run lint` clean
- [ ] `npm run build` clean

## Before merging

<!-- Delete the lines that don't apply; keep the ones an operator has to act on. -->

- [ ] **Migration** generated with `npm run db:generate` and committed (never hand-written), or: no schema change
- [ ] **`npm run db:seed`** required for new/changed templates — note that `createCollection()` copies field defs onto the collection row, so existing shelves keep the columns they were made with; adding a field to one is a manual custom-field add
- [ ] **New env var** documented in `README.md` + `.env.example`, and passed through `docker-compose.yml` (Compose reads top-level `.env`, not `.env.local`)
- [ ] **`PAYLOAD_SCHEMA_VERSION` bumped** because a provider changed which canonical keys it returns — hydrates never expire, so stale rows only refetch on a version bump
- [ ] **New provider image host** added to the `mirrorCover` allowlist in `src/lib/metadata/cover-mirror.ts` — a missing host fails the check silently and leaves the item hotlinked
- [ ] **`README.md` updated** — it's this project's design-rationale document, not just setup instructions
