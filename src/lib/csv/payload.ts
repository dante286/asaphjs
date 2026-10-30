import Papa from "papaparse";
import { CSV_ACTION_BODY_LIMIT_BYTES } from "@/lib/csv/limits";
import type { ParsedCsv } from "@/lib/csv/parse";

/**
 * What the import actions are sent instead of `ParsedCsv`. Keyed rows repeat
 * every header in every row, which roughly doubles the request for a typical
 * file; positional rows plus one header list cost little more than the file.
 *
 * Each row's cells sit in an object rather than straight in the outer array.
 * React's action decoder counts every slot *and every string character* under
 * one top-level array against a budget of a million, and an object starts a
 * fresh count — so `string[][]` fails at about 1MB of text, while this only
 * fails for a single row that size.
 */
export type CsvPayload = {
  headers: string[];
  rows: { cells: string[] }[];
};

/** React's default `arraySizeLimit` for decoding an action's arguments. */
const ACTION_ARRAY_BUDGET = 1_000_000;

export function toCsvPayload(csv: ParsedCsv): CsvPayload {
  return {
    headers: csv.headers,
    rows: csv.rows.map((row) => ({ cells: csv.headers.map((header) => row[header] ?? "") })),
  };
}

export function fromCsvPayload(payload: CsvPayload): Record<string, string>[] {
  return payload.rows.map(({ cells }) =>
    Object.fromEntries(payload.headers.map((header, i) => [header, cells[i] ?? ""])),
  );
}

/**
 * The size of the file these rows came from, near enough: the server never sees
 * the file, so it writes the rows back out as CSV and measures that. Quoting
 * can differ from the original by a few bytes either way, which doesn't matter
 * against a cap in megabytes.
 */
export function csvByteSize(payload: CsvPayload): number {
  const data = payload.rows.map((row) => row.cells);
  const text = Papa.unparse({ fields: payload.headers, data }, { newline: "\n" });
  return new TextEncoder().encode(text).byteLength;
}

/**
 * Whether Next or React would turn this payload away before the action ever
 * ran, with an error nobody could act on.
 */
export function exceedsActionBodyLimit(payload: CsvPayload): boolean {
  const rowTooBig = (cells: string[]) =>
    cells.reduce((sum, cell) => sum + cell.length + 1, 1) > ACTION_ARRAY_BUDGET;
  if (rowTooBig(payload.headers) || payload.rows.some((row) => rowTooBig(row.cells))) return true;
  return new TextEncoder().encode(JSON.stringify(payload)).byteLength > CSV_ACTION_BODY_LIMIT_BYTES;
}
