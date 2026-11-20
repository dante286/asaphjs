import { toIsoDate } from "./dates";
import { slugifyFieldLabel, type FieldDef, type FieldType } from "./field-def";

const BOOLISH = new Set(["y", "n", "yes", "no", "true", "false", "1", "0"]);

function isBlank(v: string): boolean {
  return v.trim() === "";
}

function looksNumeric(v: string): boolean {
  return v.trim() !== "" && !Number.isNaN(Number(v.trim()));
}

// Not `Date.parse`: see dates.ts for the titles it mistakes for dates.
function looksDate(v: string): boolean {
  return toIsoDate(v) !== null;
}

function looksBoolean(v: string): boolean {
  return BOOLISH.has(v.trim().toLowerCase());
}

/** Sample-based per-column type guess, per ARCHITECTURE.md's CSV import heuristics. */
export function guessColumnType(samples: string[]): FieldType {
  const nonBlank = samples.filter((s) => !isBlank(s));
  if (nonBlank.length === 0) return "text";

  if (nonBlank.every(looksBoolean)) return "checkbox";
  if (nonBlank.every(looksNumeric)) return "number";
  if (nonBlank.every(looksDate)) return "date";

  const distinct = new Set(nonBlank.map((s) => s.trim()));
  if (distinct.size <= 12 && nonBlank.length >= 30) return "select";

  const commaBearing = nonBlank.filter((s) => s.includes(",") && s.length < 60);
  if (commaBearing.length / nonBlank.length > 0.5) return "tags";

  const longish = nonBlank.some((s) => s.length > 120);
  return longish ? "longtext" : "text";
}

/** Past this many distinct values a dropdown stops being useful; the column is text. */
export const MAX_SELECT_OPTIONS = 50;

/**
 * Type and, for a select, its options. The type is guessed from the first
 * `sampleSize` values, but a select's options come from all of them: a value
 * that first shows up on row 120 has to be an option, or its `<select>`
 * renders blank.
 */
export function guessColumn(values: string[], sampleSize = 50): { type: FieldType; options?: string[] } {
  const type = guessColumnType(values.slice(0, sampleSize));
  if (type !== "select") return { type };

  const options = Array.from(new Set(values.map((v) => v.trim()).filter((v) => v !== "")));
  return options.length > MAX_SELECT_OPTIONS ? { type: "text" } : { type, options };
}

export function guessFieldsFromRows(
  headers: string[],
  rows: Record<string, string>[],
  sampleSize = 50,
): FieldDef[] {
  const usedIds = new Set<string>();

  return headers.map((header, index) => {
    const { type, options } =
      index === 0 ? { type: "text" as const, options: undefined } : guessColumn(rows.map((r) => r[header] ?? ""), sampleSize);

    let id = slugifyFieldLabel(header);
    while (usedIds.has(id)) id = `${id}_2`;
    usedIds.add(id);

    return {
      id,
      label: header,
      type,
      order: index,
      origin: "csv",
      showInTable: type !== "longtext" && type !== "image",
      options,
    } satisfies FieldDef;
  });
}
