import { describe, expect, it } from "vitest";
import { TEMPLATE_TYPE_LABELS, fieldDefSchema, slugifyFieldLabel } from "./field-def";

describe("slugifyFieldLabel", () => {
  it.each([
    ["Release Date", "release_date"],
    ["  Genre  ", "genre"],
    ["GENRE", "genre"],
    ["first-aired", "first_aired"],
    ["A  B", "a_b"],
    ["Disc #2", "disc_2"],
    // Trailing punctuation would otherwise leave a dangling separator, and a
    // field id ending in `_` reads as a typo in every URL it appears in.
    ["Paid ($)", "paid"],
  ])("slugifies %j to %j", (label, expected) => {
    expect(slugifyFieldLabel(label)).toBe(expected);
  });

  it("drops non-ASCII rather than transliterating it", () => {
    // Worth knowing: an accented label still gets a usable id, but not the one
    // a reader would guess, so `año` and `ano` collide.
    expect(slugifyFieldLabel("Año")).toBe("a_o");
  });

  it.each(["", "   ", "!!!", "___"])("falls back to `field` for %j", (label) => {
    // An id has to be a non-empty key in the values object; an empty string
    // would make the column unaddressable.
    expect(slugifyFieldLabel(label)).toBe("field");
  });

  it("is idempotent, so re-slugifying an id is safe", () => {
    const once = slugifyFieldLabel("Release Date");
    expect(slugifyFieldLabel(once)).toBe(once);
  });
});

describe("TEMPLATE_TYPE_LABELS", () => {
  it("maps every human template label onto a valid field type", () => {
    for (const [label, type] of Object.entries(TEMPLATE_TYPE_LABELS)) {
      expect(fieldDefSchema.shape.type.safeParse(type).success, label).toBe(true);
    }
  });
});

describe("fieldDefSchema", () => {
  it("accepts a minimal field definition", () => {
    const parsed = fieldDefSchema.safeParse({
      id: "genre",
      label: "Genre",
      type: "text",
      order: 1,
      origin: "template",
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects a type outside the union", () => {
    const parsed = fieldDefSchema.safeParse({
      id: "genre",
      label: "Genre",
      type: "colour",
      order: 1,
      origin: "template",
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects an origin outside the union", () => {
    const parsed = fieldDefSchema.safeParse({
      id: "genre",
      label: "Genre",
      type: "text",
      order: 1,
      origin: "imported",
    });

    expect(parsed.success).toBe(false);
  });
});
