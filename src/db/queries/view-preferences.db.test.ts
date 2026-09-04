import { beforeEach, describe, expect, it } from "vitest";
import { getViewPreferences, upsertViewPreferences } from "./view-preferences";
import { aCollection, createTestUser, type TestUser } from "@/test/db/fixtures";

/**
 * Column widths and hidden columns are per person per collection: two people
 * looking at a shared shelf each drag their own columns. The patch is
 * read-merge-write against a composite unique key, so what's tested here is
 * that the merge sees the row it should and the upsert lands on it.
 */

let user: TestUser;
let collectionId: string;

beforeEach(async () => {
  user = await createTestUser();
  const collection = await aCollection({ ownerId: user.id });
  collectionId = collection.id;
});

describe("getViewPreferences", () => {
  it("answers with defaults before anything is stored", async () => {
    // Not null: the table view renders auto-fit columns from exactly this
    // shape, so a first visit and a cleared preference look the same.
    expect(await getViewPreferences(user.id, collectionId)).toEqual({
      columnWidths: {},
      hiddenColumns: [],
    });
  });
});

describe("upsertViewPreferences", () => {
  it("stores widths and hidden columns on the first write", async () => {
    const result = await upsertViewPreferences(user.id, collectionId, {
      columnWidths: { title: 320 },
      hiddenColumns: ["paid"],
    });

    expect(result).toEqual({ columnWidths: { title: 320 }, hiddenColumns: ["paid"] });
    expect(await getViewPreferences(user.id, collectionId)).toEqual(result);
  });

  it("merges a later width in rather than replacing the set", async () => {
    await upsertViewPreferences(user.id, collectionId, { columnWidths: { title: 320 } });

    // Dragging one column sends one width; a replace would snap every other
    // column back to auto-fit.
    const result = await upsertViewPreferences(user.id, collectionId, { columnWidths: { console: 120 } });

    expect(result.columnWidths).toEqual({ title: 320, console: 120 });
  });

  it("overwrites a width for a column that already had one", async () => {
    await upsertViewPreferences(user.id, collectionId, { columnWidths: { title: 320 } });

    const result = await upsertViewPreferences(user.id, collectionId, { columnWidths: { title: 400 } });

    expect(result.columnWidths).toEqual({ title: 400 });
  });

  it("deletes the override for a column sent as null", async () => {
    await upsertViewPreferences(user.id, collectionId, { columnWidths: { title: 320, console: 120 } });

    const result = await upsertViewPreferences(user.id, collectionId, { columnWidths: { title: null } });

    // The same "null means delete" convention as ItemPatch.values — the column
    // goes back to auto-fit rather than to a width of zero.
    expect(result.columnWidths).toEqual({ console: 120 });
  });

  it("clears every width at once when asked to reset", async () => {
    await upsertViewPreferences(user.id, collectionId, {
      columnWidths: { title: 320, console: 120 },
      hiddenColumns: ["paid"],
    });

    const result = await upsertViewPreferences(user.id, collectionId, { resetColumnWidths: true });

    // "Reset widths" is about widths only: which columns are hidden is a
    // separate decision and survives.
    expect(result).toEqual({ columnWidths: {}, hiddenColumns: ["paid"] });
  });

  it("resets before applying widths sent in the same patch", async () => {
    await upsertViewPreferences(user.id, collectionId, { columnWidths: { title: 320, console: 120 } });

    const result = await upsertViewPreferences(user.id, collectionId, {
      resetColumnWidths: true,
      columnWidths: { title: 280 },
    });

    expect(result.columnWidths).toEqual({ title: 280 });
  });

  it("replaces the hidden columns rather than merging them", async () => {
    await upsertViewPreferences(user.id, collectionId, { hiddenColumns: ["paid", "console"] });

    // A list, not a patch: the column picker sends the full set, so unhiding
    // one has to be expressible.
    const result = await upsertViewPreferences(user.id, collectionId, { hiddenColumns: ["paid"] });

    expect(result.hiddenColumns).toEqual(["paid"]);
  });

  it("leaves the widths alone when the patch only hides a column", async () => {
    await upsertViewPreferences(user.id, collectionId, { columnWidths: { title: 320 } });

    const result = await upsertViewPreferences(user.id, collectionId, { hiddenColumns: ["paid"] });

    expect(result).toEqual({ columnWidths: { title: 320 }, hiddenColumns: ["paid"] });
  });

  it("keeps one person's layout out of another's", async () => {
    const guest = await createTestUser();
    await upsertViewPreferences(user.id, collectionId, { columnWidths: { title: 320 } });

    await upsertViewPreferences(guest.id, collectionId, { columnWidths: { title: 500 } });

    expect((await getViewPreferences(user.id, collectionId)).columnWidths).toEqual({ title: 320 });
    expect((await getViewPreferences(guest.id, collectionId)).columnWidths).toEqual({ title: 500 });
  });

  it("keeps one collection's layout out of another's", async () => {
    const second = await aCollection({ ownerId: user.id, name: "Books" });
    await upsertViewPreferences(user.id, collectionId, { columnWidths: { title: 320 } });

    await upsertViewPreferences(user.id, second.id, { columnWidths: { title: 500 } });

    expect((await getViewPreferences(user.id, collectionId)).columnWidths).toEqual({ title: 320 });
  });

  it("stores nothing surprising for an empty patch", async () => {
    const result = await upsertViewPreferences(user.id, collectionId, {});

    expect(result).toEqual({ columnWidths: {}, hiddenColumns: [] });
  });
});
