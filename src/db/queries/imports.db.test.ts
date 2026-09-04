import { existsSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { importBatches } from "@/db/schema";
import { commitImport, rollbackImportBatch } from "./imports";
import { listItems, patchItem } from "./items";
import { aCollection, createTestUser, writeTestUpload } from "@/test/db/fixtures";
import { UPLOADS_DIR } from "@/test/db/setup";
import type { FieldDef } from "@/lib/fields/field-def";

/**
 * A CSV import is one batch row, N item rows and a per-row error report, and
 * it has to survive a bad row rather than failing the file. The coercion is
 * pure, but which column a value lands in — a fixed column, a jsonb key, or
 * the title — is decided against the collection's own field defs, and the
 * batch is what makes the whole thing undoable.
 */

// The first field is the title (isTitleField is positional), and `verified`,
// `borrower` and `comments` are the ids that map onto real columns rather than
// into jsonb.
const FIELDS: FieldDef[] = [
  { id: "title", label: "Title", type: "text", order: 0, origin: "csv" },
  { id: "console", label: "Console", type: "select", order: 1, origin: "csv" },
  { id: "copies", label: "Copies", type: "number", order: 2, origin: "csv" },
  { id: "genre", label: "Genre", type: "tags", order: 3, origin: "csv" },
  { id: "boxed", label: "Boxed", type: "checkbox", order: 4, origin: "csv" },
  { id: "verified", label: "Verified", type: "checkbox", order: 5, origin: "csv" },
  { id: "borrower", label: "Borrower", type: "text", order: 6, origin: "csv" },
  { id: "comments", label: "Comments", type: "longtext", order: 7, origin: "csv" },
];

const MAPPING = {
  Title: "title",
  Console: "console",
  Copies: "copies",
  Genre: "genre",
  Boxed: "boxed",
  Verified: "verified",
  Borrower: "borrower",
  Comments: "comments",
};

let collectionId: string;

beforeEach(async () => {
  const owner = await createTestUser();
  const collection = await aCollection({ ownerId: owner.id, fields: FIELDS });
  collectionId = collection.id;
});

function commit(rows: Record<string, string>[], mapping: Record<string, string> = MAPPING) {
  return commitImport({ collectionId, fields: FIELDS, mapping, rows });
}

describe("commitImport", () => {
  it("coerces each cell by its field's type", async () => {
    const result = await commit([
      {
        Title: "Chrono Trigger",
        Console: "SNES",
        Copies: "2",
        Genre: "RPG, Adventure ,",
        Boxed: "yes",
        Verified: "TRUE",
        Borrower: "Alex",
        Comments: "Second copy",
      },
    ]);

    expect(result).toMatchObject({ inserted: 1, errors: [] });
    const [item] = (await listItems({ collectionId })).rows;
    expect(item).toMatchObject({
      title: "Chrono Trigger",
      // The three ids that name real columns land there, not in jsonb.
      verified: true,
      borrower: "Alex",
      notes: "Second copy",
      values: {
        console: "SNES",
        copies: 2,
        // Split, trimmed, and the trailing empty entry dropped.
        genre: ["RPG", "Adventure"],
        boxed: true,
      },
    });
    expect(item.values).not.toHaveProperty("title");
    expect(item.values).not.toHaveProperty("verified");
  });

  it.each([
    ["y", true],
    ["yes", true],
    ["true", true],
    ["1", true],
    ["Y", true],
    ["n", false],
    ["no", false],
    ["0", false],
    ["maybe", false],
  ])("reads the checkbox cell %j as %s", async (raw, expected) => {
    await commit([{ Title: "Chrono Trigger", Boxed: raw }]);

    const [item] = (await listItems({ collectionId })).rows;
    expect(item.values.boxed).toBe(expected);
  });

  it("leaves an unparseable number out rather than writing NaN", async () => {
    await commit([{ Title: "Chrono Trigger", Copies: "two" }]);

    const [item] = (await listItems({ collectionId })).rows;
    // Null, not NaN: NaN doesn't survive a round trip through jsonb.
    expect(item.values.copies).toBeNull();
  });

  it("reads an empty cell as unset for every type", async () => {
    await commit([{ Title: "Chrono Trigger", Console: "   ", Copies: "", Genre: "", Boxed: "" }]);

    const [item] = (await listItems({ collectionId })).rows;
    expect(item.values).toEqual({ console: null, copies: null, genre: null, boxed: null });
    expect(item.borrower).toBeNull();
    expect(item.notes).toBeNull();
  });

  it("skips a row with no title and reports it by its 1-based number", async () => {
    const result = await commit([
      { Title: "Chrono Trigger" },
      { Title: "   ", Console: "SNES" },
      { Title: "Earthbound" },
    ]);

    // The batch survives the bad row — a spreadsheet with one blank line in it
    // shouldn't cost the other 400 rows.
    expect(result.inserted).toBe(2);
    expect(result.errors).toEqual([{ row: 2, message: "Missing title — row skipped." }]);
    expect((await listItems({ collectionId })).total).toBe(2);
  });

  it("ignores a column mapped to __skip", async () => {
    await commit([{ Title: "Chrono Trigger", Console: "SNES", Notes: "ignore me" }], {
      ...MAPPING,
      Notes: "__skip",
    });

    const [item] = (await listItems({ collectionId })).rows;
    expect(item.values).not.toHaveProperty("Notes");
    expect(item.values.console).toBe("SNES");
  });

  it("ignores a mapping that points at a field the collection doesn't have", async () => {
    // A saved mapping outlives the field it referred to: `importMappings` is
    // persisted on the collection, and a field can be deleted afterwards.
    await commit([{ Title: "Chrono Trigger", Region: "NTSC" }], { ...MAPPING, Region: "region" });

    const [item] = (await listItems({ collectionId })).rows;
    expect(item.values).not.toHaveProperty("region");
  });

  it("ignores a header the row doesn't have", async () => {
    await commit([{ Title: "Chrono Trigger" }]);

    const [item] = (await listItems({ collectionId })).rows;
    expect(item.title).toBe("Chrono Trigger");
    expect(item.values.console).toBeNull();
  });

  it("stamps every inserted row with the batch, and records the mapping", async () => {
    const result = await commit([{ Title: "Chrono Trigger" }, { Title: "Earthbound" }]);

    const batch = await db.query.importBatches.findFirst({
      where: eq(importBatches.id, result.batchId),
    });
    expect(batch).toMatchObject({ collectionId, status: "committed", mapping: MAPPING, errorReport: [] });
    const { rows } = await listItems({ collectionId });
    expect(rows.every((r) => r.importBatchId === result.batchId)).toBe(true);
  });

  it("records the row errors on the batch, not just in the return value", async () => {
    // The import page reads them back off the batch after the redirect.
    const result = await commit([{ Title: "" }]);

    const batch = await db.query.importBatches.findFirst({
      where: eq(importBatches.id, result.batchId),
    });
    expect(batch).toMatchObject({
      status: "committed",
      errorReport: [{ row: 1, message: "Missing title — row skipped." }],
    });
  });

  it("commits a batch of nothing rather than failing", async () => {
    const result = await commit([]);

    // An empty insert would be a syntax error, so the guard around it matters;
    // the batch still lands so the UI has something to report against.
    expect(result).toMatchObject({ inserted: 0, errors: [] });
    expect(result.batchId).toBeTruthy();
  });
});

describe("rollbackImportBatch", () => {
  it("removes the batch's rows and nothing else", async () => {
    const kept = await commit([{ Title: "Kept" }]);
    const undone = await commit([{ Title: "Undone" }, { Title: "Also undone" }]);

    await rollbackImportBatch(undone.batchId);

    expect((await listItems({ collectionId })).rows.map((r) => r.title)).toEqual(["Kept"]);
    const batch = await db.query.importBatches.findFirst({
      where: eq(importBatches.id, undone.batchId),
    });
    expect(batch?.status).toBe("rolled_back");
    const keptBatch = await db.query.importBatches.findFirst({
      where: eq(importBatches.id, kept.batchId),
    });
    expect(keptBatch?.status).toBe("committed");
  });

  it("unlinks a cover added to an imported row before the undo", async () => {
    // An imported row starts without a cover, but nothing stops someone adding
    // a photo — or running a lookup — before deciding the batch was a mistake.
    const result = await commit([{ Title: "Chrono Trigger" }]);
    const [item] = (await listItems({ collectionId })).rows;
    const coverUrl = await writeTestUpload("importcover000000000.webp");
    await patchItem(item.id, { coverUrl });

    await rollbackImportBatch(result.batchId);

    expect(existsSync(path.join(UPLOADS_DIR, "importcover000000000.webp"))).toBe(false);
  });

  it("is a no-op for a batch that has nothing left", async () => {
    const result = await commit([{ Title: "Chrono Trigger" }]);
    await rollbackImportBatch(result.batchId);

    await expect(rollbackImportBatch(result.batchId)).resolves.toBeUndefined();
  });
});
