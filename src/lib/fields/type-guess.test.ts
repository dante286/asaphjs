import { describe, expect, it } from "vitest";
import { guessColumnType, guessFieldsFromRows } from "./type-guess";

/** n copies of the given values, for the sample-count thresholds. */
function repeat(values: string[], times: number): string[] {
  return Array.from({ length: times }, (_, i) => values[i % values.length]);
}

describe("guessColumnType: check ordering", () => {
  // The order the checks run in is the whole heuristic. Each of these would
  // come out differently if the checks were reordered, which is why they're
  // pinned rather than left to be rediscovered.

  it("calls a 1/0 column a checkbox, not a number", () => {
    // Both checks pass; boolean runs first because a column of 1s and 0s in a
    // collection export is a flag, not a quantity.
    expect(guessColumnType(["1", "0", "1", "1", "0"])).toBe("checkbox");
  });

  it("calls a bare-number column a number, not a date", () => {
    // Date.parse("5") succeeds — V8 reads it as a year — so a Year or Disc
    // column would become a date picker if numeric didn't run first.
    expect(guessColumnType(["5", "7", "9"])).toBe("number");
    expect(guessColumnType(["1994", "1995", "2001"])).toBe("number");
  });

  it("still calls an ISO-date column a date", () => {
    expect(guessColumnType(["2024-01-02", "1995-03-11"])).toBe("date");
  });
});

describe("guessColumnType: booleans", () => {
  it.each([
    [["Y", "N", "Y"]],
    [["yes", "no"]],
    [["true", "false"]],
    [["TRUE", "  False  "]],
  ])("recognises %j as a checkbox regardless of case or padding", (samples) => {
    expect(guessColumnType(samples)).toBe("checkbox");
  });

  it("needs every value to be boolish", () => {
    expect(guessColumnType(["yes", "no", "maybe"])).toBe("text");
  });
});

describe("guessColumnType: numbers", () => {
  it("accepts decimals and negatives", () => {
    expect(guessColumnType(["3.5", "-2", "40"])).toBe("number");
  });

  it("falls back to text when one value isn't numeric", () => {
    expect(guessColumnType(["5", "7", "unknown"])).toBe("text");
  });
});

describe("guessColumnType: blanks", () => {
  it("returns text for a column with nothing in it", () => {
    expect(guessColumnType([])).toBe("text");
    expect(guessColumnType(["", "   "])).toBe("text");
  });

  it("ignores blanks when judging the rest", () => {
    // A partly-filled numeric column is still numeric.
    expect(guessColumnType(["", "5", "  ", "7"])).toBe("number");
  });
});

describe("guessColumnType: select", () => {
  it("needs both few distinct values and enough rows to be confident", () => {
    expect(guessColumnType(repeat(["Mint", "Good", "Fair"], 30))).toBe("select");
  });

  it("won't call it a select on too small a sample", () => {
    // Three distinct values across 29 rows could just be a short file; the
    // threshold is what stops a 5-row import inventing a dropdown.
    expect(guessColumnType(repeat(["Mint", "Good", "Fair"], 29))).toBe("text");
  });

  it("won't call it a select once there are too many distinct values", () => {
    const thirteenDistinct = Array.from({ length: 13 }, (_, i) => `Publisher ${String.fromCharCode(102 + i)}`);
    expect(guessColumnType(repeat(thirteenDistinct, 39))).toBe("text");
  });
});

describe("guessColumnType: tags", () => {
  it("needs more than half the values to bear a comma", () => {
    expect(guessColumnType(["Action, RPG", "Puzzle, Indie", "Racing"])).toBe("tags");
  });

  it("treats an even split as not enough", () => {
    // The rule is a strict majority: exactly half is as likely to be prose
    // with a comma in it as it is a list.
    expect(guessColumnType(["Action, RPG", "Puzzle, Indie", "Racing", "Sports"])).toBe("text");
  });

  it("doesn't count commas in a long value", () => {
    // A 60-character-plus value with commas is a sentence, not a tag list.
    const sentence = "It arrived boxed, complete, and in better shape than expected.";
    expect(sentence.length).toBeGreaterThanOrEqual(60);
    expect(guessColumnType([sentence, sentence, sentence])).toBe("text");
  });
});

describe("guessColumnType: long text", () => {
  it("upgrades to longtext when any value is over 120 characters", () => {
    expect(guessColumnType(["short", "x".repeat(121)])).toBe("longtext");
  });

  it("stays text at the boundary", () => {
    expect(guessColumnType(["short", "x".repeat(120)])).toBe("text");
  });
});

describe("guessFieldsFromRows", () => {
  it("forces the first column to text whatever it looks like", () => {
    // Column 0 becomes the item title, which is a fixed text column — guessing
    // `number` for a catalogue-number-first export would make it unwritable.
    const [first] = guessFieldsFromRows(["Catalogue No"], [{ "Catalogue No": "451" }]);

    expect(first.type).toBe("text");
  });

  it("slugifies the header into the field id and keeps the header as the label", () => {
    const [, second] = guessFieldsFromRows(
      ["Title", "Release Date!"],
      [{ Title: "Chrono Trigger", "Release Date!": "1995-03-11" }],
    );

    expect(second).toMatchObject({ id: "release_date", label: "Release Date!", type: "date" });
  });

  it("suffixes duplicate headers so two columns can't share an id", () => {
    // The suffix is applied by re-testing the whole id, so the third
    // collision stacks: genre, genre_2, genre_2_2.
    const fields = guessFieldsFromRows(
      ["Title", "Genre", "Genre", "Genre"],
      [{ Title: "Chrono Trigger", Genre: "RPG" }],
    );

    expect(fields.map((f) => f.id)).toEqual(["title", "genre", "genre_2", "genre_2_2"]);
  });

  it("records the distinct values as options, but only for a select", () => {
    const rows = repeat(["Mint", "Good"], 30).map((condition, i) => ({
      Title: `Item ${i}`,
      Condition: condition,
    }));

    const [title, condition] = guessFieldsFromRows(["Title", "Condition"], rows);

    expect(condition.type).toBe("select");
    expect(condition.options).toEqual(["Mint", "Good"]);
    expect(title.options).toBeUndefined();
  });

  it("hides long text from the table view", () => {
    const fields = guessFieldsFromRows(
      ["Title", "Notes"],
      [{ Title: "Chrono Trigger", Notes: "x".repeat(200) }],
    );

    expect(fields[1]).toMatchObject({ type: "longtext", showInTable: false });
    expect(fields[0].showInTable).toBe(true);
  });

  it("only looks at the first sampleSize rows", () => {
    const rows = [{ Title: "a", Year: "1994" }, { Title: "b", Year: "1995" }, { Title: "c", Year: "unknown" }];

    // The row that would break the numeric guess is outside the sample.
    expect(guessFieldsFromRows(["Title", "Year"], rows, 2)[1].type).toBe("number");
    expect(guessFieldsFromRows(["Title", "Year"], rows)[1].type).toBe("text");
  });

  it("treats a header missing from a row as blank rather than crashing", () => {
    const fields = guessFieldsFromRows(["Title", "Year"], [{ Title: "Chrono Trigger" }]);

    expect(fields[1].type).toBe("text");
  });

  it("stamps order and origin from the column position", () => {
    const fields = guessFieldsFromRows(["Title", "Genre"], [{ Title: "a", Genre: "RPG" }]);

    expect(fields.map((f) => [f.order, f.origin])).toEqual([
      [0, "csv"],
      [1, "csv"],
    ]);
  });
});
