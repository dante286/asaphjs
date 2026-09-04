import { describe, expect, it } from "vitest";
import { buildPrefillPlan, isBlankValue } from "./prefill";
import { field, item } from "@/test/factories";
import type { FieldDef } from "@/lib/fields/field-def";
import type { HydratedFields } from "./types";

// Index 0 is the title field by position, not by label, so every fields array
// here starts with one — otherwise the field under test would be read as the
// title and the test would be measuring the wrong branch.
const TITLE = field({ id: "title", label: "Title", order: 0 });

function planFor(
  subject: FieldDef,
  hydrated: HydratedFields,
  opts: { values?: Record<string, unknown>; overwrite?: boolean } = {},
) {
  return buildPrefillPlan(
    [TITLE, { ...subject, order: 1 }],
    item({ title: "Chrono Trigger", values: opts.values ?? {} }),
    hydrated,
    { overwrite: opts.overwrite },
  );
}

describe("isBlankValue", () => {
  it("treats null, undefined, whitespace-only strings and empty arrays as blank", () => {
    expect(isBlankValue(null)).toBe(true);
    expect(isBlankValue(undefined)).toBe(true);
    expect(isBlankValue("")).toBe(true);
    expect(isBlankValue("   ")).toBe(true);
    expect(isBlankValue([])).toBe(true);
  });

  it("does not treat false or 0 as blank", () => {
    // An unchecked checkbox and a zero price are answers, not absences — if
    // these read as blank, a prefill would be allowed to overwrite them.
    expect(isBlankValue(false)).toBe(false);
    expect(isBlankValue(0)).toBe(false);
    expect(isBlankValue(["Action"])).toBe(false);
  });
});

describe("buildPrefillPlan: select fields", () => {
  const consoleField = (options?: string[]) =>
    field({ id: "console", label: "Console", type: "select", options });

  it("only fills a select with one of its own options", () => {
    // FieldCell renders a <select>; a value outside the option list would show
    // as blank, so no value at all is the honest outcome.
    const plan = planFor(consoleField(["SNES", "Nintendo 64"]), { platforms: ["Super Nintendo"] });

    expect(plan.patch.values).toBeUndefined();
    expect(plan.applied).toEqual([]);
    expect(plan.keptExisting).toEqual([]);
  });

  it("matches an option case- and whitespace-insensitively but stores the option's own spelling", () => {
    const plan = planFor(consoleField(["SNES", "Nintendo 64"]), { platforms: ["  snes "] });

    expect(plan.patch.values).toEqual({ console: "SNES" });
    expect(plan.applied).toEqual(["Console"]);
  });

  it("takes the first provider value that matches an option, not the first value", () => {
    const plan = planFor(consoleField(["SNES"]), { platforms: ["Satellaview", "SNES", "Wii"] });

    expect(plan.patch.values).toEqual({ console: "SNES" });
  });

  it("falls back to a lone value when the select has no options configured", () => {
    expect(planFor(consoleField(), { platforms: ["SNES"] }).patch.values).toEqual({
      console: "SNES",
    });
  });

  it("leaves an optionless select alone when the provider names several values", () => {
    expect(planFor(consoleField(), { platforms: ["SNES", "Wii"] }).patch.values).toBeUndefined();
  });
});

describe("buildPrefillPlan: joining multi-valued provider data", () => {
  it("joins a genre list into a text field", () => {
    const plan = planFor(field({ id: "genre", label: "Genre" }), {
      genre: ["Role-playing", "JRPG"],
    });

    expect(plan.patch.values).toEqual({ genre: "Role-playing, JRPG" });
  });

  it("refuses to join a platform list into a text field", () => {
    // "Satellaview, SNES, Wii" is not an answer to which console your copy is
    // for, so the field stays empty rather than holding something misleading.
    const plan = planFor(field({ id: "console", label: "Console" }), {
      platforms: ["Satellaview", "SNES", "Wii"],
    });

    expect(plan.patch.values).toBeUndefined();
    expect(plan.applied).toEqual([]);
  });

  it("fills a text console field when there is exactly one platform", () => {
    const plan = planFor(field({ id: "console", label: "Console" }), { platforms: ["SNES"] });

    expect(plan.patch.values).toEqual({ console: "SNES" });
  });

  it("hands a tags field the whole list", () => {
    const plan = planFor(field({ id: "genre", label: "Genre", type: "tags" }), {
      genre: ["Role-playing", "JRPG"],
    });

    expect(plan.patch.values).toEqual({ genre: ["Role-playing", "JRPG"] });
  });

  it("drops blank and non-string entries before deciding", () => {
    const plan = planFor(field({ id: "genre", label: "Genre", type: "tags" }), {
      genre: ["Role-playing", "", "   ", null, 7] as unknown as string[],
    });

    expect(plan.patch.values).toEqual({ genre: ["Role-playing"] });
  });
});

describe("buildPrefillPlan: typed coercion", () => {
  it("coerces a numeric provider value for a number field", () => {
    const plan = planFor(field({ id: "year", label: "Year", type: "number" }), { year: 1995 });

    expect(plan.patch.values).toEqual({ year: 1995 });
  });

  it("leaves a number field alone when the value isn't a finite number", () => {
    const plan = planFor(field({ id: "year", label: "Year", type: "number" }), {
      year: "unknown" as unknown as number,
    });

    expect(plan.patch.values).toBeUndefined();
  });

  it("only accepts a full YYYY-MM-DD for a date field", () => {
    const releaseDate = field({ id: "release_date", label: "Release Date", type: "date" });

    expect(planFor(releaseDate, { releaseDate: "1995-03-11" }).patch.values).toEqual({
      release_date: "1995-03-11",
    });
    // A bare year-month is what some providers return for an old title; a date
    // input can't render it, so it isn't stored.
    expect(planFor(releaseDate, { releaseDate: "1995-03" }).patch.values).toBeUndefined();
    expect(planFor(releaseDate, { releaseDate: "1995" }).patch.values).toBeUndefined();
  });
});

describe("buildPrefillPlan: which fields are reachable at all", () => {
  it.each(["checkbox", "currency", "rating", "image"] as const)(
    "never fills a %s field even when a provider has the data",
    (type) => {
      // Currency and rating are the owner's own valuation, image is handled as
      // the cover, and a checkbox is a fact about the copy on the shelf.
      const plan = planFor(field({ id: "genre", label: "Genre", type }), {
        genre: ["Role-playing"],
      });

      expect(plan.patch.values).toBeUndefined();
      expect(plan.applied).toEqual([]);
    },
  );

  it("never fills a fixed-column field", () => {
    const plan = planFor(field({ id: "comments", label: "Comments", type: "longtext" }), {
      summary: "A time-travelling RPG.",
    });

    expect(plan.patch.values).toBeUndefined();
    expect(plan.patch.notes).toBeUndefined();
  });

  it("ignores a field id no canonical key maps to", () => {
    const plan = planFor(field({ id: "condition", label: "Condition" }), {
      condition: "Mint",
      genre: ["Role-playing"],
    });

    expect(plan.patch.values).toBeUndefined();
  });

  it.each([
    ["manufacturer", "developer", "Squaresoft"],
    ["artist", "author", "Akira Toriyama"],
    ["franchise", "series", "Chrono"],
    ["first_aired", "releaseDate", "1995-03-11"],
    ["synopsis", "summary", "A time-travelling RPG."],
  ])("routes the %s field from the %s canonical key", (fieldId, canonical, value) => {
    const plan = planFor(field({ id: fieldId, label: fieldId }), { [canonical]: value });

    expect(plan.patch.values).toEqual({ [fieldId]: value });
  });
});

describe("buildPrefillPlan: blank-only versus overwrite", () => {
  const genre = field({ id: "genre", label: "Genre" });

  it("keeps an existing value and reports it as kept", () => {
    const plan = planFor(genre, { genre: ["Role-playing"] }, { values: { genre: "Adventure" } });

    expect(plan.patch.values).toBeUndefined();
    expect(plan.applied).toEqual([]);
    expect(plan.keptExisting).toEqual(["Genre"]);
  });

  it("replaces an existing value when overwrite is set", () => {
    const plan = planFor(
      genre,
      { genre: ["Role-playing"] },
      { values: { genre: "Adventure" }, overwrite: true },
    );

    expect(plan.patch.values).toEqual({ genre: "Role-playing" });
    expect(plan.applied).toEqual(["Genre"]);
    expect(plan.keptExisting).toEqual([]);
  });

  it("treats a whitespace-only existing value as blank and fills it", () => {
    const plan = planFor(genre, { genre: ["Role-playing"] }, { values: { genre: "   " } });

    expect(plan.patch.values).toEqual({ genre: "Role-playing" });
    expect(plan.applied).toEqual(["Genre"]);
  });

  it("reports nothing when an overwrite would write the value already there", () => {
    // Neither applied nor kept: the UI would otherwise claim it changed a field
    // whose stored value is identical.
    const plan = planFor(
      genre,
      { genre: ["Role-playing"] },
      { values: { genre: "Role-playing" }, overwrite: true },
    );

    expect(plan.patch.values).toBeUndefined();
    expect(plan.applied).toEqual([]);
    expect(plan.keptExisting).toEqual([]);
  });

  it("reports every field it touched, in field order", () => {
    const plan = buildPrefillPlan(
      [
        TITLE,
        field({ id: "developer", label: "Developer", order: 1 }),
        field({ id: "genre", label: "Genre", order: 2 }),
        field({ id: "series", label: "Series", order: 3 }),
      ],
      item({ title: "Chrono Trigger", values: { genre: "Adventure" } }),
      { developer: "Squaresoft", genre: ["Role-playing"], series: "Chrono" },
    );

    expect(plan.applied).toEqual(["Developer", "Series"]);
    expect(plan.keptExisting).toEqual(["Genre"]);
    expect(plan.patch.values).toEqual({ developer: "Squaresoft", series: "Chrono" });
  });
});

describe("buildPrefillPlan: title promotion", () => {
  const titleOnly = [field({ id: "name", label: "Name", order: 0 })];

  it("promotes the title to the fixed column rather than values, whatever the field is labeled", () => {
    const plan = buildPrefillPlan(titleOnly, item(), { title: "  Chrono Trigger  " });

    expect(plan.patch.title).toBe("Chrono Trigger");
    expect(plan.patch.values).toBeUndefined();
    expect(plan.applied).toEqual(["Name"]);
  });

  it("keeps an owner's title and reports it as kept", () => {
    const plan = buildPrefillPlan(titleOnly, item({ title: "Chrono Trigger (JP)" }), {
      title: "Chrono Trigger",
    });

    expect(plan.patch.title).toBeUndefined();
    expect(plan.keptExisting).toEqual(["Name"]);
  });

  it("overwrites an owner's title when asked", () => {
    const plan = buildPrefillPlan(
      titleOnly,
      item({ title: "Chrono Trigger (JP)" }),
      { title: "Chrono Trigger" },
      { overwrite: true },
    );

    expect(plan.patch.title).toBe("Chrono Trigger");
    expect(plan.applied).toEqual(["Name"]);
  });

  it("reports nothing when the provider's title is what's already stored", () => {
    const plan = buildPrefillPlan(titleOnly, item({ title: "Chrono Trigger" }), {
      title: "Chrono Trigger",
    });

    expect(plan.patch.title).toBeUndefined();
    expect(plan.applied).toEqual([]);
    expect(plan.keptExisting).toEqual([]);
  });

  it.each([{ title: "   " }, {}])("ignores a provider title of %j", (hydrated) => {
    const plan = buildPrefillPlan(titleOnly, item(), hydrated);

    expect(plan.patch.title).toBeUndefined();
    expect(plan.applied).toEqual([]);
  });
});

describe("buildPrefillPlan: cover art", () => {
  const fields = [TITLE];
  const cover = "https://images.igdb.com/igdb/image/upload/t_cover_big/abc.jpg";

  it("fills a blank cover and reports it under its own name", () => {
    const plan = buildPrefillPlan(fields, item({ title: "Chrono Trigger" }), { coverUrl: cover });

    expect(plan.patch.coverUrl).toBe(cover);
    expect(plan.applied).toEqual(["Cover"]);
  });

  it("keeps a cover the owner already has", () => {
    const plan = buildPrefillPlan(
      fields,
      item({ title: "Chrono Trigger", coverUrl: "/api/uploads/mine.webp" }),
      { coverUrl: cover },
    );

    expect(plan.patch.coverUrl).toBeUndefined();
    expect(plan.keptExisting).toEqual(["Cover"]);
  });

  it("replaces an existing cover when overwrite is set", () => {
    const plan = buildPrefillPlan(
      fields,
      item({ title: "Chrono Trigger", coverUrl: "/api/uploads/mine.webp" }),
      { coverUrl: cover },
      { overwrite: true },
    );

    expect(plan.patch.coverUrl).toBe(cover);
    expect(plan.applied).toEqual(["Cover"]);
  });

  it("reports nothing when the cover is unchanged", () => {
    const plan = buildPrefillPlan(fields, item({ title: "Chrono Trigger", coverUrl: cover }), {
      coverUrl: cover,
    });

    expect(plan.patch.coverUrl).toBeUndefined();
    expect(plan.applied).toEqual([]);
    expect(plan.keptExisting).toEqual([]);
  });

  it("leaves the cover out of the patch when the provider has none", () => {
    const plan = buildPrefillPlan(fields, item({ title: "Chrono Trigger" }), {});

    expect(plan.patch).toEqual({});
    expect(plan.applied).toEqual([]);
  });
});
