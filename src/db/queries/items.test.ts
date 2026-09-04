import { describe, expect, it } from "vitest";
import { stripItemsForPublic } from "./items";
import { field } from "@/test/factories";

// This module imports the Drizzle client, so these tests also stand as proof
// that importing it costs nothing: `new Pool()` doesn't dial, so the unit tier
// stays honest about needing no DATABASE_URL.

const FIELDS = [
  field({ id: "title", label: "Title", order: 0 }),
  field({ id: "console", label: "Console", order: 1 }),
  field({ id: "purchase_price", label: "Paid", type: "currency", order: 2, private: true }),
];

function row(over: Record<string, unknown> = {}) {
  return {
    id: "itm_1",
    title: "Chrono Trigger",
    borrower: "Alex",
    notes: "Second copy, keep the boxed one.",
    values: { console: "SNES", purchase_price: 220 },
    ...over,
  };
}

describe("stripItemsForPublic", () => {
  it("blanks the borrower and the notes", () => {
    // Who has your things and what you wrote about them are not part of a
    // public shelf, whatever the fields are configured to show.
    const [stripped] = stripItemsForPublic([row()], FIELDS);

    expect(stripped.borrower).toBeNull();
    expect(stripped.notes).toBeNull();
  });

  it("drops the values of fields marked private", () => {
    const [stripped] = stripItemsForPublic([row()], FIELDS);

    expect(stripped.values).toEqual({ console: "SNES" });
    expect("purchase_price" in stripped.values).toBe(false);
  });

  it("keeps everything else on the row", () => {
    const [stripped] = stripItemsForPublic([row()], FIELDS);

    expect(stripped.id).toBe("itm_1");
    expect(stripped.title).toBe("Chrono Trigger");
  });

  it("does not mutate its input", () => {
    // The same rows are handed to the share page and the items route; a strip
    // that mutated in place would leak or double-strip depending on call order.
    const input = [row()];

    stripItemsForPublic(input, FIELDS);

    expect(input[0].borrower).toBe("Alex");
    expect(input[0].notes).toBe("Second copy, keep the boxed one.");
    expect(input[0].values).toEqual({ console: "SNES", purchase_price: 220 });
  });

  it("gives each row a fresh values object rather than sharing the original", () => {
    const input = [row()];
    const [stripped] = stripItemsForPublic(input, FIELDS);

    stripped.values.console = "Nintendo 64";

    expect(input[0].values.console).toBe("SNES");
  });

  it("strips every row, not just the first", () => {
    const stripped = stripItemsForPublic([row(), row({ id: "itm_2" })], FIELDS);

    expect(stripped.map((r) => r.borrower)).toEqual([null, null]);
    expect(stripped.map((r) => r.values)).toEqual([{ console: "SNES" }, { console: "SNES" }]);
  });

  it("leaves values alone when no field is private", () => {
    const [stripped] = stripItemsForPublic([row()], FIELDS.filter((f) => !f.private));

    expect(stripped.values).toEqual({ console: "SNES", purchase_price: 220 });
    // Borrower and notes are stripped by column, not by field config, so they
    // still go even when the fields array says nothing about them.
    expect(stripped.borrower).toBeNull();
  });

  it("handles an empty result set", () => {
    expect(stripItemsForPublic([], FIELDS)).toEqual([]);
  });

  it("ignores a private field with no value on this row", () => {
    const [stripped] = stripItemsForPublic([row({ values: { console: "SNES" } })], FIELDS);

    expect(stripped.values).toEqual({ console: "SNES" });
  });
});
