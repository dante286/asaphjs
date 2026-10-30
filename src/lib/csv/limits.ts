/**
 * The CSV picker, the import actions and next.config.ts all read these, so the
 * file cap the user sees and the request cap Next enforces can't drift. Kept
 * free of imports for that reason — next.config.ts loads this file directly.
 */
export const MAX_CSV_BYTES = 5 * 1024 * 1024;
export const MAX_CSV_MB = MAX_CSV_BYTES / 1024 / 1024;

/**
 * Server Action bodies are capped at 1MB unless next.config.ts says otherwise,
 * and the rows travel as JSON, not as the file: every cell gains a pair of
 * quotes, so a 5MB file of short cells encodes to roughly 6MB, and one of
 * mostly single-character cells to nearly 10MB. Twice the file cap covers any
 * realistic file; one that still doesn't fit is caught in the browser before
 * it's sent (see `exceedsActionBodyLimit`). This applies to every action in the
 * app, not just the import.
 */
export const CSV_ACTION_BODY_LIMIT_BYTES = 2 * MAX_CSV_BYTES;

export function csvTooLargeMessage(bytes?: number) {
  const cap = `CSV files are capped at ${MAX_CSV_MB} MB.`;
  if (bytes === undefined) return cap;
  return `That file is ${(bytes / 1024 / 1024).toFixed(1)} MB. ${cap}`;
}
