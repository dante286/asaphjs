import { describe, expect, it } from "vitest";
import { slugify } from "./collections";

/**
 * The input to the whole slug system, and the one part of it that means
 * anything without a database — `uniqueSlug` and `withFreshSlug` are covered
 * against real rows and a real unique index in collections.db.test.ts.
 *
 * What a name becomes matters beyond tidiness: the slug *is* the URL, and it is
 * resolved against whoever is viewing rather than against an owner.
 */

describe("slugify", () => {
  it.each([
    ["Video Games", "video-games"],
    ["  Movies  ", "movies"],
    ["Movies!", "movies"],
    ["Sci-Fi & Fantasy", "sci-fi-fantasy"],
    ["My_Games", "my-games"],
    ["Chrono   Trigger", "chrono-trigger"],
    ["1080p Rips", "1080p-rips"],
  ])("turns %j into %j", (name, expected) => {
    expect(slugify(name)).toBe(expected);
  });

  it("collapses a run of separators into one hyphen", () => {
    expect(slugify("Movies -- & --- Shows")).toBe("movies-shows");
  });

  it("never leaves a leading or trailing hyphen", () => {
    // A URL ending in a hyphen reads as a typo, and a leading one would make
    // the path look like a flag.
    expect(slugify("...Movies...")).toBe("movies");
    expect(slugify("-Movies-")).toBe("movies");
  });

  it.each([
    ["", "empty"],
    ["   ", "only spaces"],
    ["!!!", "only punctuation"],
    ["葬送のフリーレン", "no Latin characters at all"],
    ["🎮🎮", "only emoji"],
  ])("falls back to 'collection' for %j (%s)", (name) => {
    // Every non-ASCII name lands on the same base, so the second such
    // collection becomes `collection-2` — the suffix walk is what keeps them
    // distinct, and the URL stops being descriptive rather than breaking.
    expect(slugify(name)).toBe("collection");
  });

  it("keeps the ASCII out of a mixed name", () => {
    expect(slugify("葬送のフリーレン Frieren")).toBe("frieren");
  });
});
