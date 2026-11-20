import Papa from "papaparse";

export type ParsedCsv = {
  headers: string[];
  rows: Record<string, string>[];
};

export function parseCsvText(text: string): ParsedCsv {
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });

  const headers = result.meta.fields ?? [];
  // `skipEmptyLines: true` only skips truly empty lines. A spreadsheet's
  // export often ends in rows of bare commas (`,,,`), which parse as rows of
  // empty cells and would each be reported as a row missing its title.
  const rows = result.data.filter((row) => Object.values(row).some((cell) => String(cell ?? "").trim() !== ""));
  return { headers, rows };
}
