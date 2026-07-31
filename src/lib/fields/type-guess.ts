import { slugifyFieldLabel, type FieldDef, type FieldType } from "./field-def";

const BOOLISH = new Set(["y", "n", "yes", "no", "true", "false", "1", "0"]);

function isBlank(v: string): boolean {
  return v.trim() === "";
}

function looksNumeric(v: string): boolean {
  return v.trim() !== "" && !Number.isNaN(Number(v.trim()));
}

function looksDate(v: string): boolean {
  if (isBlank(v)) return false;
  const t = Date.parse(v.trim());
  return !Number.isNaN(t);
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

export function guessFieldsFromRows(
  headers: string[],
  rows: Record<string, string>[],
  sampleSize = 50,
): FieldDef[] {
  const sample = rows.slice(0, sampleSize);
  const usedIds = new Set<string>();

  return headers.map((header, index) => {
    const samples = sample.map((r) => r[header] ?? "");
    const type = index === 0 ? "text" : guessColumnType(samples);

    let id = slugifyFieldLabel(header);
    while (usedIds.has(id)) id = `${id}_2`;
    usedIds.add(id);

    const distinctValues =
      type === "select" ? Array.from(new Set(samples.filter((s) => !isBlank(s)))) : undefined;

    return {
      id,
      label: header,
      type,
      order: index,
      origin: "csv",
      showInTable: type !== "longtext" && type !== "image",
      options: distinctValues,
    } satisfies FieldDef;
  });
}
