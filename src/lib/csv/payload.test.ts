import { describe, expect, it } from "vitest";
import { CSV_ACTION_BODY_LIMIT_BYTES, MAX_CSV_BYTES, csvTooLargeMessage } from "./limits";
import { parseCsvText } from "./parse";
import { csvByteSize, exceedsActionBodyLimit, fromCsvPayload, toCsvPayload } from "./payload";

// The import actions are sent positional rows and rebuild keyed ones, and the
// server measures the file it never saw from them — so the round trip and the
// measurement are what the 5 MB cap actually rests on.

describe("toCsvPayload / fromCsvPayload", () => {
  it("round-trips the keyed rows the parser produces", () => {
    const csv = parseCsvText('Title,Genre,Notes\n"Zelda, The",Action,\nEarthbound,RPG,"says ""hi"""\n');

    const payload = toCsvPayload(csv);

    expect(payload).toEqual({
      headers: ["Title", "Genre", "Notes"],
      rows: [{ cells: ["Zelda, The", "Action", ""] }, { cells: ["Earthbound", "RPG", 'says "hi"'] }],
    });
    expect(fromCsvPayload(payload)).toEqual(csv.rows);
  });

  it("fills a short row with empty cells rather than undefined", () => {
    expect(fromCsvPayload({ headers: ["Title", "Genre"], rows: [{ cells: ["Chrono Trigger"] }] })).toEqual([
      { Title: "Chrono Trigger", Genre: "" },
    ]);
  });
});

describe("csvByteSize", () => {
  it("measures the file the rows came from", () => {
    const text = 'Title,Genre\n"Zelda, The",Action\nÉtrange,RPG';

    expect(csvByteSize(toCsvPayload(parseCsvText(text)))).toBe(new TextEncoder().encode(text).byteLength);
  });

  it("puts a file over the cap over it", () => {
    const payload = { headers: ["Title"], rows: [{ cells: ["x".repeat(MAX_CSV_BYTES)] }] };

    expect(csvByteSize(payload)).toBeGreaterThan(MAX_CSV_BYTES);
  });
});

describe("exceedsActionBodyLimit", () => {
  it("lets a typical file at the cap through", () => {
    // Twelve columns of ordinary values, filled to just under 5 MB: the shape
    // issue #118 was written about, at forty times the size.
    const row = ["Game", "Nintendo Switch", "1", "Action, Adventure", "yes", "no", "", "Some notes about this copy", "NTSC", "Some Publisher", "2001", "Good"];
    const headers = row.map((_, i) => `Column ${i}`);
    const rowBytes = csvByteSize({ headers: [], rows: [{ cells: row }] }) + 1;
    const rows = Array.from({ length: Math.floor(MAX_CSV_BYTES / rowBytes) - 1 }, () => ({ cells: row }));
    const payload = { headers, rows };

    expect(csvByteSize(payload)).toBeGreaterThan(MAX_CSV_BYTES * 0.99);
    expect(csvByteSize(payload)).toBeLessThanOrEqual(MAX_CSV_BYTES);
    expect(exceedsActionBodyLimit(payload)).toBe(false);
  });

  it("catches a payload Next would refuse for its size", () => {
    const rows = Array.from({ length: 1100 }, () => ({ cells: ["x".repeat(CSV_ACTION_BODY_LIMIT_BYTES / 1000)] }));

    expect(exceedsActionBodyLimit({ headers: ["Title"], rows })).toBe(true);
  });

  it("catches a single row React would refuse to decode", () => {
    // Well under the body limit, but one row's text is past the million
    // characters React allows under one array.
    const payload = { headers: ["Title"], rows: [{ cells: ["x".repeat(1_000_000)] }] };

    expect(exceedsActionBodyLimit(payload)).toBe(true);
  });
});

describe("csvTooLargeMessage", () => {
  it("names the cap, and the file's size when there is one", () => {
    expect(csvTooLargeMessage()).toBe("CSV files are capped at 5 MB.");
    expect(csvTooLargeMessage(7.25 * 1024 * 1024)).toBe("That file is 7.3 MB. CSV files are capped at 5 MB.");
  });
});
