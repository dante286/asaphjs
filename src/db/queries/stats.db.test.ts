import { beforeEach, describe, expect, it } from "vitest";
import { createItem } from "./items";
import { getBreakdown, getCollectionStats, pickBreakdownField } from "./stats";
import { aCollection, createTestUser, testFields } from "@/test/db/fixtures";
import type { FieldDef } from "@/lib/fields/field-def";

/**
 * Every number on the collection header and the breakdown panel comes from two
 * queries, both of which put the rule in the SQL: `count(*) filter (...)` for
 * the tallies, and `values->>'<field id>'` for the facet — so the group-by is
 * over a jsonb key chosen at runtime from the collection's own field defs.
 */

const FIELDS = testFields();

let collectionId: string;

beforeEach(async () => {
  const owner = await createTestUser();
  const collection = await aCollection({ ownerId: owner.id, fields: FIELDS });
  collectionId = collection.id;
});

function anItem(title: string, over: Partial<Parameters<typeof createItem>[0]> = {}) {
  return createItem({ collectionId, title, ...over });
}

describe("getCollectionStats", () => {
  it("tallies items, verified and lent in one pass", async () => {
    await anItem("Chrono Trigger", { verified: true, values: { console: "SNES" } });
    await anItem("Earthbound", { borrower: "Alex", values: { console: "SNES" } });
    await anItem("Super Metroid", { verified: true, borrower: "Sam", values: { console: "SNES" } });
    await anItem("Ocarina of Time", { values: { console: "N64" } });

    expect(await getCollectionStats(collectionId, FIELDS)).toEqual({
      itemCount: 4,
      verifiedCount: 2,
      lentCount: 2,
      // Two distinct values of the first select field.
      distinctFacetCount: 2,
      facetLabel: "Console",
    });
  });

  it("answers zeroes for an empty collection", async () => {
    // An aggregate over no rows still returns one row, which is what keeps the
    // header renderable before the first item exists.
    expect(await getCollectionStats(collectionId, FIELDS)).toEqual({
      itemCount: 0,
      verifiedCount: 0,
      lentCount: 0,
      distinctFacetCount: 0,
      facetLabel: "Console",
    });
  });

  it("leaves the facet null when no field is a select", async () => {
    const noSelect: FieldDef[] = [
      { id: "title", label: "Title", type: "text", order: 0, origin: "custom" },
      { id: "author", label: "Author", type: "text", order: 1, origin: "custom" },
    ];
    await anItem("Chrono Trigger");

    // Null rather than 0: the breakdown panel is hidden entirely, which is a
    // different thing from a panel showing nothing.
    expect(await getCollectionStats(collectionId, noSelect)).toMatchObject({
      itemCount: 1,
      distinctFacetCount: null,
      facetLabel: null,
    });
  });

  it("doesn't count an unset facet as a value of its own", async () => {
    // `count(distinct ...)` skips nulls, so items with nothing in the field
    // don't inflate the number the header shows.
    await anItem("Chrono Trigger", { values: { console: "SNES" } });
    await anItem("Earthbound", { values: {} });
    await anItem("Super Metroid", { values: { console: null } });

    expect(await getCollectionStats(collectionId, FIELDS)).toMatchObject({ distinctFacetCount: 1 });
  });

  it("counts only its own collection", async () => {
    const other = await createTestUser();
    const elsewhere = await aCollection({ ownerId: other.id, name: "Elsewhere" });
    await createItem({ collectionId: elsewhere.id, title: "Not mine", verified: true });
    await anItem("Chrono Trigger");

    expect(await getCollectionStats(collectionId, FIELDS)).toMatchObject({
      itemCount: 1,
      verifiedCount: 0,
    });
  });
});

describe("getBreakdown", () => {
  const facet = FIELDS[1];

  it("groups by the field's jsonb value, most common first", async () => {
    await anItem("Chrono Trigger", { values: { console: "SNES" } });
    await anItem("Earthbound", { values: { console: "SNES" } });
    await anItem("Ocarina of Time", { values: { console: "N64" } });

    expect(await getBreakdown(collectionId, facet)).toEqual([
      { label: "SNES", count: 2 },
      { label: "N64", count: 1 },
    ]);
  });

  it("labels the items with nothing in the field", async () => {
    await anItem("Chrono Trigger", { values: { console: "SNES" } });
    await anItem("Earthbound", { values: {} });
    await anItem("Super Metroid", { values: { console: null } });

    // A jsonb null and an absent key both read as "Unset" — one bucket, since
    // to an owner they are the same thing.
    expect(await getBreakdown(collectionId, facet)).toEqual([
      { label: "Unset", count: 2 },
      { label: "SNES", count: 1 },
    ]);
  });

  it("stops at the limit, keeping the largest groups", async () => {
    for (const [console, copies] of [["SNES", 4], ["N64", 3], ["GBA", 2], ["NES", 1]] as const) {
      for (let i = 0; i < copies; i++) await anItem(`${console} ${i}`, { values: { console } });
    }

    const top = await getBreakdown(collectionId, facet, 2);

    expect(top).toEqual([
      { label: "SNES", count: 4 },
      { label: "N64", count: 3 },
    ]);
  });

  it("defaults to eight groups", async () => {
    for (let i = 0; i < 10; i++) await anItem(`Game ${i}`, { values: { console: `Console ${i}` } });

    expect(await getBreakdown(collectionId, facet)).toHaveLength(8);
  });

  it("answers nothing for an empty collection", async () => {
    // A group-by over no rows has no groups — unlike the aggregate above,
    // which always has one row.
    expect(await getBreakdown(collectionId, facet)).toEqual([]);
  });

  it("reads a field id that isn't a plain word", async () => {
    // Field ids are slugified labels, but `values->>` takes the id as a
    // parameter rather than as interpolated SQL, so an odd one is still data.
    const odd: FieldDef = { id: "co'ncept", label: "Concept", type: "select", order: 1, origin: "custom" };
    await anItem("Chrono Trigger", { values: { "co'ncept": "Time travel" } });

    expect(await getBreakdown(collectionId, odd)).toEqual([{ label: "Time travel", count: 1 }]);
  });
});

describe("pickBreakdownField", () => {
  it("takes the first select field", () => {
    // Pure, so this is the one thing in the module that needs no rows — kept
    // here beside the query it decides the shape of.
    expect(pickBreakdownField(FIELDS)?.id).toBe("console");
    expect(pickBreakdownField([FIELDS[0]])).toBeNull();
  });
});
