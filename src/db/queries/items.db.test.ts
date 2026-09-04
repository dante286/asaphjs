import { existsSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createItem,
  deleteItem,
  getItem,
  getItemNeighbors,
  listItems,
  patchItem,
} from "./items";
import { aCollection, createTestUser, writeTestUpload } from "@/test/db/fixtures";
import { UPLOADS_DIR } from "@/test/db/setup";

/**
 * `patchItem` is the reason this file needs Postgres: it merges and deletes
 * jsonb keys with a raw `||` / `- text[]` expression inside a transaction that
 * takes `FOR UPDATE`, and implements `If-Match` on top of that. None of it
 * means anything without the server actually evaluating it.
 *
 * `sortTitle` is a generated column (`lower(title)`), so every ordering
 * assertion here is testing something Postgres computes rather than anything
 * this code sends.
 */

let collectionId: string;

beforeEach(async () => {
  const owner = await createTestUser();
  const collection = await aCollection({ ownerId: owner.id });
  collectionId = collection.id;
});

function anItem(title: string, over: Partial<Parameters<typeof createItem>[0]> = {}) {
  return createItem({ collectionId, title, ...over });
}

describe("createItem", () => {
  it("lands complete rather than as a bare title", async () => {
    const item = await anItem("Chrono Trigger", {
      values: { console: "SNES", paid: 220 },
      verified: true,
      borrower: "Alex",
      notes: "Second copy",
      externalRef: { source: "igdb", id: "1017", fetchedAt: "2026-09-04T00:00:00.000Z" },
    });

    expect(item).toMatchObject({
      title: "Chrono Trigger",
      values: { console: "SNES", paid: 220 },
      verified: true,
      borrower: "Alex",
      notes: "Second copy",
      // Provenance the server writes when a lookup is applied — never
      // something a client sends, which is why it isn't on the wire-facing
      // ItemPatch the items PATCH route accepts.
      externalRef: { source: "igdb", id: "1017", fetchedAt: "2026-09-04T00:00:00.000Z" },
      coverUrl: null,
      lentOn: null,
    });
  });

  it("defaults the rest rather than leaving nulls in jsonb", async () => {
    const item = await anItem("Earthbound");

    expect(item).toMatchObject({ values: {}, verified: false, borrower: null, externalRef: null });
  });

  it("gets a sort title from Postgres", async () => {
    // A generated column, so nothing in the app maintains it — including when a
    // title is patched later.
    const item = await anItem("The Legend of Zelda");

    expect(item.sortTitle).toBe("the legend of zelda");
  });
});

describe("listItems", () => {
  beforeEach(async () => {
    await anItem("Chrono Trigger", { verified: true });
    await anItem("earthbound", { borrower: "Alex" });
    await anItem("Super Metroid", { verified: true, borrower: "Sam" });
  });

  it("orders by sort title, which is case-insensitive", async () => {
    const { rows, total } = await listItems({ collectionId });

    // "earthbound" sorts between the capitals rather than after them, which is
    // the whole reason the generated column exists.
    expect(rows.map((r) => r.title)).toEqual(["Chrono Trigger", "earthbound", "Super Metroid"]);
    expect(total).toBe(3);
  });

  it("orders by recency when asked", async () => {
    const { rows } = await listItems({ collectionId, sort: "updated" });

    expect(rows.map((r) => r.title)).toEqual(["Super Metroid", "earthbound", "Chrono Trigger"]);
  });

  it("searches titles case-insensitively, anywhere in the string", async () => {
    const { rows, total } = await listItems({ collectionId, q: "TRIG" });

    expect(rows.map((r) => r.title)).toEqual(["Chrono Trigger"]);
    expect(total).toBe(1);
  });

  it("filters to verified and to lent, and combines the two", async () => {
    expect((await listItems({ collectionId, verifiedOnly: true })).total).toBe(2);
    expect((await listItems({ collectionId, lentOnly: true })).total).toBe(2);
    expect((await listItems({ collectionId, verifiedOnly: true, lentOnly: true })).rows).toMatchObject([
      { title: "Super Metroid" },
    ]);
  });

  it("counts the whole filtered set, not the page", async () => {
    // The count query carries the same `where` but no limit — a page of 2 out
    // of 3 has to say 3 or the pager can't render.
    const { rows, total, page, pageSize } = await listItems({ collectionId, pageSize: 2 });

    expect(rows).toHaveLength(2);
    expect({ total, page, pageSize }).toEqual({ total: 3, page: 1, pageSize: 2 });
  });

  it("offsets to the requested page", async () => {
    const { rows } = await listItems({ collectionId, pageSize: 2, page: 2 });

    expect(rows.map((r) => r.title)).toEqual(["Super Metroid"]);
  });

  it("sees only its own collection", async () => {
    const other = await createTestUser();
    const elsewhere = await aCollection({ ownerId: other.id, name: "Someone else" });
    await createItem({ collectionId: elsewhere.id, title: "Chrono Trigger" });

    expect((await listItems({ collectionId })).total).toBe(3);
  });
});

describe("patchItem", () => {
  it("merges the given jsonb keys and leaves the rest", async () => {
    const item = await anItem("Chrono Trigger", { values: { console: "SNES", region: "NTSC", paid: 220 } });

    const result = await patchItem(item.id, { values: { console: "SNES Mini", boxed: true } });

    expect(result.ok).toBe(true);
    // `||` merges rather than replaces: per-field autosave sends one key at a
    // time, so a replace would blank every other field on the row.
    expect(result.ok && result.item.values).toEqual({
      console: "SNES Mini",
      region: "NTSC",
      paid: 220,
      boxed: true,
    });
  });

  it("deletes the keys sent as null", async () => {
    const item = await anItem("Chrono Trigger", { values: { console: "SNES", region: "NTSC" } });

    const result = await patchItem(item.id, { values: { region: null } });

    // Removed, not set to null — an absent key is what "unset" means to
    // everything that reads `values`.
    expect(result.ok && result.item.values).toEqual({ console: "SNES" });
  });

  it("merges and deletes in one patch", async () => {
    const item = await anItem("Chrono Trigger", { values: { console: "SNES", region: "NTSC" } });

    const result = await patchItem(item.id, { values: { console: "SFC", region: null, boxed: true } });

    expect(result.ok && result.item.values).toEqual({ console: "SFC", boxed: true });
  });

  it("leaves values untouched when the patch doesn't mention them", async () => {
    const item = await anItem("Chrono Trigger", { values: { console: "SNES" } });

    const result = await patchItem(item.id, { title: "Chrono Trigger (JP)" });

    expect(result.ok && result.item).toMatchObject({
      title: "Chrono Trigger (JP)",
      values: { console: "SNES" },
    });
  });

  it("survives a value that would break the jsonb literal", async () => {
    // The merge object is serialised and cast, so a quote or a brace in a
    // user's own text has to travel as data.
    const item = await anItem("Chrono Trigger");

    const result = await patchItem(item.id, {
      values: { notes: `{"injected": true}'; drop table items; --`, quote: 'a "quoted" word' },
    });

    expect(result.ok && result.item.values).toEqual({
      notes: `{"injected": true}'; drop table items; --`,
      quote: 'a "quoted" word',
    });
    expect(await getItem(item.id)).toBeTruthy();
  });

  it("distinguishes a false or empty patch from an absent one", async () => {
    // `!== undefined` rather than truthiness: unverifying an item, returning it
    // from a loan and clearing a note all send falsy values.
    const item = await anItem("Chrono Trigger", { verified: true, borrower: "Alex", notes: "keep" });

    const result = await patchItem(item.id, { verified: false, borrower: null, notes: "" });

    expect(result.ok && result.item).toMatchObject({ verified: false, borrower: null, notes: "" });
  });

  it("writes the fixed columns, including a lent-on date", async () => {
    const item = await anItem("Chrono Trigger");

    const result = await patchItem(item.id, {
      coverUrl: "/api/uploads/abc.webp",
      borrower: "Alex",
      lentOn: "2026-09-04",
    });

    expect(result.ok && result.item).toMatchObject({
      coverUrl: "/api/uploads/abc.webp",
      borrower: "Alex",
      lentOn: "2026-09-04",
    });
  });

  it("writes the provenance a lookup leaves behind, and clears it", async () => {
    // `externalRef` is on InternalItemPatch rather than the wire-facing
    // ItemPatch: the server writes it when a match is applied, and nothing a
    // client sends can set it.
    const item = await anItem("Chrono Trigger");
    const ref = { source: "igdb", id: "1017", fetchedAt: "2026-09-04T00:00:00.000Z" };

    const applied = await patchItem(item.id, { externalRef: ref });
    expect(applied.ok && applied.item.externalRef).toEqual(ref);

    // Unmatching an item has to be expressible too, and null is a value here
    // rather than "leave it alone".
    const cleared = await patchItem(item.id, { externalRef: null });
    expect(cleared.ok && cleared.item.externalRef).toBeNull();
  });

  it("recomputes the sort title after a rename", async () => {
    const item = await anItem("Chrono Trigger");

    const result = await patchItem(item.id, { title: "Zelda" });

    expect(result.ok && result.item.sortTitle).toBe("zelda");
  });

  it("moves updatedAt forward", async () => {
    const item = await anItem("Chrono Trigger");

    const result = await patchItem(item.id, { title: "Renamed" });

    // What If-Match is compared against, so it has to change on every write.
    expect(result.ok && result.item.updatedAt.getTime()).toBeGreaterThan(item.updatedAt.getTime());
  });

  it("reports a missing item rather than throwing", async () => {
    expect(await patchItem("00000000-0000-0000-0000-000000000000", { title: "x" })).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  describe("If-Match", () => {
    it("accepts the version the caller last saw", async () => {
      const item = await anItem("Chrono Trigger");

      const result = await patchItem(item.id, { title: "Renamed" }, item.updatedAt.toISOString());

      expect(result.ok).toBe(true);
    });

    it("refuses a stale version and hands back the current row", async () => {
      const item = await anItem("Chrono Trigger");
      const stale = item.updatedAt.toISOString();
      await patchItem(item.id, { title: "Renamed by someone else" });

      const result = await patchItem(item.id, { title: "Renamed by me" }, stale);

      // The current row comes back with the refusal: the conflict UI shows what
      // the other writer put there rather than making the client refetch.
      expect(result).toMatchObject({ ok: false, reason: "conflict" });
      expect(!result.ok && result.reason === "conflict" && result.current.title).toBe(
        "Renamed by someone else",
      );
    });

    it("leaves the row alone when it refuses", async () => {
      const item = await anItem("Chrono Trigger", { values: { console: "SNES" } });
      const stale = new Date(item.updatedAt.getTime() - 1000).toISOString();

      await patchItem(item.id, { title: "Nope", values: { console: null } }, stale);

      expect(await getItem(item.id)).toMatchObject({
        title: "Chrono Trigger",
        values: { console: "SNES" },
      });
    });

    it("serialises two writers so the second sees the first's row", async () => {
      // `FOR UPDATE` inside the transaction is what makes this ordering exist
      // at all — without it both writers read the same row and the later write
      // silently wins.
      const item = await anItem("Chrono Trigger");
      const version = item.updatedAt.toISOString();

      const [first, second] = await Promise.all([
        patchItem(item.id, { title: "Writer A" }, version),
        patchItem(item.id, { title: "Writer B" }, version),
      ]);

      const outcomes = [first.ok, second.ok].sort();
      expect(outcomes).toEqual([false, true]);
    });
  });
});

describe("deleteItem", () => {
  it("removes the row", async () => {
    const item = await anItem("Chrono Trigger");

    await deleteItem(item.id);

    expect(await getItem(item.id)).toBeUndefined();
  });

  it("takes the item's cover file and thumbnail with it", async () => {
    // Cleanup lives in the query rather than the route so the next caller
    // can't forget it: a deleted item's photo is unreachable the moment its row
    // is gone, and `uploads/` is a mounted volume nobody sweeps.
    const coverUrl = await writeTestUpload("itemcover00000000000.webp");
    const item = await anItem("Chrono Trigger", { coverUrl });

    await deleteItem(item.id);

    expect(existsSync(path.join(UPLOADS_DIR, "itemcover00000000000.webp"))).toBe(false);
    expect(existsSync(path.join(UPLOADS_DIR, "itemcover00000000000_t.webp"))).toBe(false);
  });

  it("does nothing for an id that isn't there", async () => {
    await expect(deleteItem("00000000-0000-0000-0000-000000000000")).resolves.toBeUndefined();
  });
});

describe("getItemNeighbors", () => {
  it("walks the collection's title order", async () => {
    const a = await anItem("Aardvark");
    const b = await anItem("Bandicoot");
    const c = await anItem("Capybara");

    expect(await getItemNeighbors(collectionId, b.id)).toEqual({
      position: 2,
      total: 3,
      prevId: a.id,
      nextId: c.id,
    });
  });

  it("has no previous at the start and no next at the end", async () => {
    const a = await anItem("Aardvark");
    const b = await anItem("Bandicoot");

    expect(await getItemNeighbors(collectionId, a.id)).toMatchObject({ position: 1, prevId: null });
    expect(await getItemNeighbors(collectionId, b.id)).toMatchObject({ position: 2, nextId: null });
  });

  it("ignores the caller's filter and search", async () => {
    // Deliberate: previous/next walk the full collection, so paging through
    // items doesn't change meaning when a search box is left filled in.
    await anItem("Aardvark", { verified: true });
    const b = await anItem("Bandicoot");
    await anItem("Capybara", { verified: true });

    expect(await getItemNeighbors(collectionId, b.id)).toMatchObject({ position: 2, total: 3 });
  });

  it("answers nothing for an item that isn't in that collection", async () => {
    const other = await createTestUser();
    const elsewhere = await aCollection({ ownerId: other.id, name: "Elsewhere" });
    const stranger = await createItem({ collectionId: elsewhere.id, title: "Chrono Trigger" });

    expect(await getItemNeighbors(collectionId, stranger.id)).toBeNull();
  });
});
