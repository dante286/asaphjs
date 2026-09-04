import { describe, expect, it } from "vitest";
import { parseCsvText } from "./parse";

// These pin the Papaparse options this wrapper chose, because the import
// mapping UI is built directly on `headers` and the type guess is built on
// `rows` — a change in either shape moves both without a compiler error.

describe("parseCsvText", () => {
  it("reads the header row into headers and keys each row by it", () => {
    const { headers, rows } = parseCsvText("Title,Genre\nChrono Trigger,RPG\n");

    expect(headers).toEqual(["Title", "Genre"]);
    expect(rows).toEqual([{ Title: "Chrono Trigger", Genre: "RPG" }]);
  });

  it("trims padding off the headers", () => {
    // A spreadsheet export with " Genre " would otherwise produce a field
    // labelled with the spaces and a mapping key nobody can match.
    const { headers, rows } = parseCsvText(" Title , Genre \nA,B\n");

    expect(headers).toEqual(["Title", "Genre"]);
    expect(rows).toEqual([{ Title: "A", Genre: "B" }]);
  });

  it("keeps a comma inside a quoted field", () => {
    const { rows } = parseCsvText('Title,Genre\n"Zelda, The",Action\n');

    expect(rows).toEqual([{ Title: "Zelda, The", Genre: "Action" }]);
  });

  it("skips blank lines rather than importing empty items", () => {
    const { rows } = parseCsvText("Title\nA\n\n\nB\n");

    expect(rows).toEqual([{ Title: "A" }, { Title: "B" }]);
  });

  it("handles CRLF line endings", () => {
    const { rows } = parseCsvText("Title,Genre\r\nA,B\r\n");

    expect(rows).toEqual([{ Title: "A", Genre: "B" }]);
  });

  it("strips a UTF-8 BOM off the first header", () => {
    // Excel writes one, and without stripping it the first column's header
    // never matches anything in the mapping step.
    const { headers } = parseCsvText("﻿Title,Genre\nA,B\n");

    expect(headers).toEqual(["Title", "Genre"]);
  });

  it("auto-detects a semicolon delimiter", () => {
    // What a European locale's Excel produces.
    const { headers, rows } = parseCsvText("Title;Genre\nA;B\n");

    expect(headers).toEqual(["Title", "Genre"]);
    expect(rows).toEqual([{ Title: "A", Genre: "B" }]);
  });

  it("renames a duplicate header instead of letting one column shadow the other", () => {
    // Papaparse's own `_1` suffix, which is a different mechanism from the
    // `_2` suffix guessFieldsFromRows applies to field ids — this one keeps
    // the row object from losing a column, that one keeps ids unique.
    const { headers, rows } = parseCsvText("Genre,Genre\nA,B\n");

    expect(headers).toEqual(["Genre", "Genre_1"]);
    expect(rows).toEqual([{ Genre: "A", Genre_1: "B" }]);
  });

  it("omits the key entirely for a short row", () => {
    // Which is why the type guess reads `row[header] ?? ""` rather than
    // trusting every row to carry every column.
    const { rows } = parseCsvText("Title,Genre\nA\n");

    expect(rows).toEqual([{ Title: "A" }]);
    expect("Genre" in rows[0]).toBe(false);
  });

  it("returns nothing for empty input", () => {
    expect(parseCsvText("")).toEqual({ headers: [], rows: [] });
  });

  it("returns the headers and no rows for a header-only file", () => {
    expect(parseCsvText("Title,Genre\n")).toEqual({ headers: ["Title", "Genre"], rows: [] });
  });
});
