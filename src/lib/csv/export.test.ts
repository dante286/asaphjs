import { describe, expect, it } from "vitest";
import { csvCell, csvSectionHeading } from "./export";

describe("csvCell", () => {
  it("defuses text a spreadsheet would run as a formula", () => {
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("+SUM(A1:A9)")).toBe("'+SUM(A1:A9)");
    expect(csvCell("-2+3")).toBe("'-2+3");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell("\t=1")).toBe("'\t=1");
    // Quoted as well, because of the comma and quotes inside.
    expect(csvCell('=HYPERLINK("https://evil.example","click")')).toBe(
      '"\'=HYPERLINK(""https://evil.example"",""click"")"',
    );
  });

  it("leaves numbers alone, as numbers or as text", () => {
    expect(csvCell(-5)).toBe("-5");
    expect(csvCell("-5")).toBe("-5");
    expect(csvCell("+12.50")).toBe("+12.50");
    expect(csvCell(220)).toBe("220");
  });

  it("leaves ordinary text alone", () => {
    expect(csvCell("Chrono Trigger")).toBe("Chrono Trigger");
    expect(csvCell("a = b")).toBe("a = b");
    expect(csvCell(true)).toBe("true");
  });

  it("quotes what CSV needs quoted, carriage returns included", () => {
    expect(csvCell('The "Best"')).toBe('"The ""Best"""');
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell("line one\nline two")).toBe('"line one\nline two"');
    expect(csvCell("line one\rline two")).toBe('"line one\rline two"');
  });

  it("writes an unset value as an empty cell", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });
});

describe("csvSectionHeading", () => {
  it("keeps a collection name on its one line", () => {
    expect(csvSectionHeading("Games\n=1+1,evil")).toBe("# Games =1+1,evil");
    expect(csvSectionHeading("Books")).toBe("# Books");
  });
});
