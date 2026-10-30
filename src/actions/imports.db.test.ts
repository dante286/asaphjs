import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCollectionById, getCollectionForUser } from "@/db/queries/collections";
import { listItems } from "@/db/queries/items";
import { acceptInvite, inviteMember } from "@/db/queries/members";
import { aCollection, createTestUser, type TestUser } from "@/test/db/fixtures";
import { signedInAs, signedOut } from "@/test/db/session";
import type { FieldDef } from "@/lib/fields/field-def";
import type { CsvPayload } from "@/lib/csv/payload";

/**
 * The two ends of a CSV import: making a collection out of a file, and adding
 * a file to a collection that already exists. The second one writes the
 * collection's fields and mapping before the rows, so a mid-import failure
 * would leave a shelf with columns and no items — and it's an editor-level
 * action, unlike the sharing ones.
 */
vi.mock("next/headers", async () => {
  const { sessionHeaders } = await import("@/test/db/session");
  return { headers: async () => sessionHeaders() };
});

const actions = await import("./imports");

const FIELDS: FieldDef[] = [
  { id: "title", label: "Title", type: "text", order: 0, origin: "csv" },
  { id: "console", label: "Console", type: "select", order: 1, origin: "csv" },
  { id: "copies", label: "Copies", type: "number", order: 2, origin: "csv" },
];

const MAPPING = { Title: "title", Console: "console", Copies: "copies" };

const ROWS = [
  { Title: "Chrono Trigger", Console: "SNES", Copies: "2" },
  { Title: "Earthbound", Console: "SNES", Copies: "1" },
];

/** The wire shape the wizard sends, built from keyed rows so these read as a CSV would. */
function csvOf(rows: Record<string, string>[]): CsvPayload {
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return { headers, rows: rows.map((row) => ({ cells: headers.map((header) => row[header] ?? "") })) };
}

/** Six 1MB titles: a file over the cap without six megabytes of fixture. */
const OVERSIZED = csvOf(
  Array.from({ length: 6 }, (_, i) => ({ Title: String(i).repeat(1024 * 1024) })),
);

async function importInto(input: Parameters<typeof actions.importCsvIntoCollectionAction>[0]) {
  const result = await actions.importCsvIntoCollectionAction(input);
  if ("error" in result) throw new Error(result.error);
  return result;
}

let owner: TestUser;

beforeEach(async () => {
  owner = await createTestUser();
  signedInAs(owner);
});

describe("importCsvIntoNewCollectionAction", () => {
  it("creates the collection and lands on it with the count", async () => {
    const error = await actions
      .importCsvIntoNewCollectionAction({
        name: "Video Games",
        fields: FIELDS,
        mapping: MAPPING,
        csv: csvOf(ROWS),
      })
      .catch((e: unknown) => e);

    // The redirect carries the number of rows, which is what the collection
    // page reads to show "imported 2 items".
    expect((error as { digest: string }).digest).toBe(
      "NEXT_REDIRECT;replace;/collections/video-games?imported=2;307;",
    );
    const collection = await getCollectionForUser(owner.id, "video-games");
    expect(collection).toMatchObject({ name: "Video Games", fields: FIELDS, templateKey: null });
    expect((await listItems({ collectionId: collection!.id })).total).toBe(2);
  });

  it("counts only the rows it could import", async () => {
    const error = await actions
      .importCsvIntoNewCollectionAction({
        name: "Video Games",
        fields: FIELDS,
        mapping: MAPPING,
        csv: csvOf([...ROWS, { Title: "   ", Console: "SNES" }]),
      })
      .catch((e: unknown) => e);

    // A blank title is skipped and reported rather than failing the file, so
    // the count in the URL is the number that actually landed.
    expect((error as { digest: string }).digest).toContain("imported=2");
  });

  it("takes the view and the features the wizard chose", async () => {
    await actions
      .importCsvIntoNewCollectionAction({
        name: "Video Games",
        fields: FIELDS,
        mapping: MAPPING,
        csv: csvOf([]),
        defaultView: "table",
        features: { lending: true },
      })
      .catch(() => {});

    // A CSV import lands in the table view by default in the UI; a collection
    // made from a spreadsheet is usually read as one.
    expect(await getCollectionForUser(owner.id, "video-games")).toMatchObject({
      defaultView: "table",
      features: { lending: true },
    });
  });

  it("rejects a field list that isn't one", async () => {
    // The action is a public POST endpoint, so the fields are parsed rather
    // than merely typed — they're written into a jsonb column the whole UI
    // reads back.
    await expect(
      actions.importCsvIntoNewCollectionAction({
        name: "Video Games",
        fields: [{ id: "title", label: "Title", type: "not-a-type" } as unknown as FieldDef],
        mapping: MAPPING,
        csv: csvOf(ROWS),
      }),
    ).rejects.toThrow();
  });

  it("turns away a file over the cap before creating anything", async () => {
    // The picker checks the file first, but the action is a public endpoint;
    // the refusal comes back as a value so production builds keep the message.
    const result = await actions.importCsvIntoNewCollectionAction({
      name: "Video Games",
      fields: FIELDS,
      mapping: MAPPING,
      csv: OVERSIZED,
    });

    expect(result).toEqual({ error: "CSV files are capped at 5 MB." });
    expect(await getCollectionForUser(owner.id, "video-games")).toBeNull();
  });

  it("needs a session", async () => {
    signedOut();

    await expect(
      actions.importCsvIntoNewCollectionAction({
        name: "Video Games",
        fields: FIELDS,
        mapping: MAPPING,
        csv: csvOf(ROWS),
      }),
    ).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") });
  });
});

describe("importCsvIntoCollectionAction", () => {
  let collectionId: string;

  beforeEach(async () => {
    const collection = await aCollection({ ownerId: owner.id, fields: FIELDS });
    collectionId = collection.id;
  });

  it("imports the rows and reports what happened", async () => {
    const result = await importInto({
      collectionId,
      fields: FIELDS,
      mapping: MAPPING,
      csv: csvOf(ROWS),
    });

    expect(result).toMatchObject({ inserted: 2, errors: [] });
    expect((await listItems({ collectionId })).total).toBe(2);
  });

  it("saves the field list and the mapping onto the collection", async () => {
    // Persisted so a repeat import of the same export needs no remapping, and
    // so a column the CSV added is on the shelf before its values arrive.
    const withRegion = [
      ...FIELDS,
      { id: "region", label: "Region", type: "select", order: 3, origin: "csv" } as FieldDef,
    ];

    await actions.importCsvIntoCollectionAction({
      collectionId,
      fields: withRegion,
      mapping: { ...MAPPING, Region: "region" },
      csv: csvOf([{ Title: "Chrono Trigger", Region: "NTSC" }]),
    });

    const collection = await getCollectionById(collectionId);
    expect(collection?.fields).toEqual(withRegion);
    expect(collection?.importMappings).toEqual({ ...MAPPING, Region: "region" });
    expect((await listItems({ collectionId })).rows[0].values).toMatchObject({ region: "NTSC" });
  });

  it("reports a bad row rather than failing the file", async () => {
    const result = await importInto({
      collectionId,
      fields: FIELDS,
      mapping: MAPPING,
      csv: csvOf([{ Title: "Chrono Trigger" }, { Title: "" }, { Title: "Earthbound" }]),
    });

    expect(result.inserted).toBe(2);
    expect(result.errors).toEqual([{ row: 2, message: "Missing title — row skipped." }]);
  });

  it("turns away a file over the cap, and writes neither fields nor rows", async () => {
    const result = await actions.importCsvIntoCollectionAction({
      collectionId,
      fields: [...FIELDS, { id: "extra", label: "Extra", type: "text", order: 3, origin: "csv" }],
      mapping: MAPPING,
      csv: OVERSIZED,
    });

    expect(result).toEqual({ error: "CSV files are capped at 5 MB." });
    expect((await getCollectionById(collectionId))?.fields).toEqual(FIELDS);
    expect((await listItems({ collectionId })).total).toBe(0);
  });

  it("lets an editor import", async () => {
    const editor = await createTestUser();
    const invite = await inviteMember({
      collectionId,
      invitedEmail: editor.email,
      role: "editor",
      invitedBy: owner.id,
    });
    await acceptInvite(invite.inviteToken!, editor.id, editor.email);
    signedInAs(editor);

    // Filling a shelf is what an editor is for.
    const result = await importInto({
      collectionId,
      fields: FIELDS,
      mapping: MAPPING,
      csv: csvOf(ROWS),
    });

    expect(result.inserted).toBe(2);
  });

  it("refuses a viewer", async () => {
    const viewer = await createTestUser();
    const invite = await inviteMember({
      collectionId,
      invitedEmail: viewer.email,
      role: "viewer",
      invitedBy: owner.id,
    });
    await acceptInvite(invite.inviteToken!, viewer.id, viewer.email);
    signedInAs(viewer);

    await expect(
      actions.importCsvIntoCollectionAction({ collectionId, fields: FIELDS, mapping: MAPPING, csv: csvOf(ROWS) }),
    ).rejects.toThrow("Not authorized.");
    expect((await listItems({ collectionId })).total).toBe(0);
  });

  it("refuses a stranger, and writes neither fields nor rows", async () => {
    const stranger = await createTestUser();
    signedInAs(stranger);

    await expect(
      actions.importCsvIntoCollectionAction({
        collectionId,
        fields: [{ id: "hijacked", label: "Hijacked", type: "text", order: 0, origin: "csv" }],
        mapping: { Title: "hijacked" },
        csv: csvOf([{ Title: "Chrono Trigger" }]),
      }),
    ).rejects.toThrow("Not authorized.");

    // The guard is before the field write, which matters: this action replaces
    // a collection's whole field list.
    expect((await getCollectionById(collectionId))?.fields).toEqual(FIELDS);
    expect((await listItems({ collectionId })).total).toBe(0);
  });
});

describe("rollbackImportBatchAction", () => {
  let collectionId: string;

  beforeEach(async () => {
    const collection = await aCollection({ ownerId: owner.id, fields: FIELDS });
    collectionId = collection.id;
  });

  it("undoes one batch and leaves the others", async () => {
    const kept = await importInto({
      collectionId,
      fields: FIELDS,
      mapping: MAPPING,
      csv: csvOf([{ Title: "Kept" }]),
    });
    const undone = await importInto({
      collectionId,
      fields: FIELDS,
      mapping: MAPPING,
      csv: csvOf(ROWS),
    });

    await actions.rollbackImportBatchAction(collectionId, undone.batchId);

    const { rows } = await listItems({ collectionId });
    expect(rows.map((r) => r.title)).toEqual(["Kept"]);
    expect(kept.batchId).not.toBe(undone.batchId);
  });

  it("refuses a viewer", async () => {
    const result = await importInto({
      collectionId,
      fields: FIELDS,
      mapping: MAPPING,
      csv: csvOf(ROWS),
    });
    const viewer = await createTestUser();
    const invite = await inviteMember({
      collectionId,
      invitedEmail: viewer.email,
      role: "viewer",
      invitedBy: owner.id,
    });
    await acceptInvite(invite.inviteToken!, viewer.id, viewer.email);
    signedInAs(viewer);

    await expect(actions.rollbackImportBatchAction(collectionId, result.batchId)).rejects.toThrow(
      "Not authorized.",
    );
    expect((await listItems({ collectionId })).total).toBe(2);
  });

  it("checks the role against the collection it was given", async () => {
    // The batch id isn't checked against the collection, so the guard is doing
    // all the work here — a caller has to be able to write to the collection
    // they name.
    const result = await importInto({
      collectionId,
      fields: FIELDS,
      mapping: MAPPING,
      csv: csvOf(ROWS),
    });
    const stranger = await createTestUser();
    signedInAs(stranger);

    await expect(actions.rollbackImportBatchAction(collectionId, result.batchId)).rejects.toThrow(
      "Not authorized.",
    );
    expect((await listItems({ collectionId })).total).toBe(2);
  });
});
