# CSV import

A CSV can start a new collection or add rows to an existing one. The browser parses the file
(`src/lib/csv/parse.ts`), guesses a type per column, and the owner maps each column to a field,
a new field, or nothing. The rows then go to a Server Action — `importCsvIntoNewCollectionAction`
or `importCsvIntoCollectionAction` in `src/actions/imports.ts` — which hands them to
`commitImport` in `src/db/queries/imports.ts`. How to use it is in the
[user guide](../user-guide.md#importing-a-csv); this page is why the size limit and the
plumbing behind it look the way they do.

## Files are capped at 5 MB

Before the cap, an import sent every row in one Server Action call, which Next caps at 1 MB,
and inserted them in one statement, which Postgres caps at 65,535 bind parameters. Past either limit the import failed with an error nobody could act on. The fix
was to pick a size, make everything under it actually import, and say what the size is.

5 MB is `MAX_CSV_BYTES` in `src/lib/csv/limits.ts`. It's tens of thousands of rows for a
typical collection export, and far past what a home library needs. It's checked three times,
for different reasons:

- **In the picker, before the file is read** (`CsvDropzone`). An oversized file is never
  parsed or sent, and the dropzone says "Up to 5 MB" up front.
- **In the wizard, before the action is called** (`exceedsActionBodyLimit`). A file under the
  cap can still encode to a request Next or React would refuse — see below — and refusing it
  here gives the owner a sentence rather than a framework error.
- **In both actions.** A Server Action is a public endpoint whatever the page renders, so the
  server measures the rows again (`csvByteSize`, which writes them back out as CSV, since the
  server never sees the file). An oversized payload comes back as `{ error }` rather than a
  throw, because a production build replaces thrown messages with a generic one.

`limits.ts` has no imports of its own, because `next.config.ts` loads it directly. That's what
keeps the cap the picker shows and the request limit Next enforces from drifting apart.

## Rows travel as a header list plus positional cells

The wizard used to send `ParsedCsv` as is: an array of objects keyed by header. That repeats
every header in every row and roughly doubles the request for a typical file. `CsvPayload`
(`src/lib/csv/payload.ts`) sends one `headers` list and each row as positional `cells`, which
costs about 1.2× the file. `toCsvPayload` and `fromCsvPayload` convert either way, so
`commitImport` still gets keyed rows.

**Each row's cells are wrapped in an object** — `{ cells: string[] }` rather than a bare
`string[]` — for a reason that's easy to undo by accident. React's Server Action decoder counts
every slot, and every string character, under one top-level array against a budget of a
million (`arraySizeLimit`), and an object starts a fresh count. So `string[][]` fails at about
1 MB of text no matter what Next's body limit says, while the wrapped shape only fails for a
single row that size. `exceedsActionBodyLimit` checks that case too.

## The Server Action body limit is raised for every action

Rows travel as JSON, not as the file, and every cell gains a pair of quotes. A 5 MB file of
short cells encodes to roughly 6 MB, and one of mostly single-character cells to nearly 10 MB.
So `experimental.serverActions.bodySizeLimit` in `next.config.ts` is
`CSV_ACTION_BODY_LIMIT_BYTES`, twice the file cap. That covers any realistic file, and one
that still doesn't fit is caught in the browser before it's sent.

Next has one body limit for all Server Actions, so this applies to every action in the app,
not just the import. Nothing else sends anywhere near that much, but the server will now read
up to 10 MB for any action request, and it reads the body before the action's own session
check runs. If that ever matters, the alternative is a route handler for imports with its own
limit, and the default 1 MB back for everything else.

A reverse proxy in front of the instance has its own limit, and it applies first. See
[Request size limits](../self-hosting.md#request-size-limits).

## Inserts run 500 rows at a time, in one transaction

An item row binds about seven parameters, so a single `INSERT` breaks somewhere past 9,000
rows; a 5 MB file can hold 40,000. `commitImport` inserts `INSERT_CHUNK_ROWS` (500) per
statement, all inside one transaction that also marks the `import_batches` row `committed`.
If any chunk fails, the chunks before it go with it and the batch stays `staged`, so there's
never a half-imported file to find and clean up by hand.

Rows without a title are skipped rather than failing the import, and come back in the batch's
error report with their row number. **Undo this import** is `rollbackImportBatch`: every item
carries its `import_batch_id`, so it deletes those items, marks the batch `rolled_back`, and
sweeps any cover photos added to them since — an imported row starts without a cover, but
nothing stops someone adding one before deciding the whole batch was a mistake.

Not here: streaming or resumable uploads, server-side parsing of the raw file, and imports
bigger than the cap. Splitting a file and importing the pieces into the same collection
works today.
