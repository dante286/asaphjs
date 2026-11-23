import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { collections, importBatches, items } from "@/db/schema";
import type { ImportRowError } from "@/db/schema/import-batches";
import type { FieldDef } from "@/lib/fields/field-def";
import { toIsoDate } from "@/lib/fields/dates";
import { isTitleField } from "@/lib/fields/item-values";
import { releaseUploads } from "./uploads";
import type { ImportMappings } from "@/types";

const TRUE_VALUES = new Set(["y", "yes", "true", "1"]);
const FALSE_VALUES = new Set(["n", "no", "false", "0"]);

type Coerced = { value: unknown; problem?: string };

/**
 * A cell as its field's type. A cell that doesn't read as that type still
 * gets a value — blank for a number, unchecked for a checkbox — but also a
 * `problem`, so the import reports it rather than losing the text silently.
 */
function coerceCsvValue(type: FieldDef["type"], raw: string): Coerced {
  const trimmed = raw.trim();
  if (trimmed === "") return { value: null };

  switch (type) {
    case "checkbox": {
      const lower = trimmed.toLowerCase();
      if (TRUE_VALUES.has(lower)) return { value: true };
      if (FALSE_VALUES.has(lower)) return { value: false };
      return { value: false, problem: `"${trimmed}" isn't yes or no — read as no.` };
    }
    case "number":
      return Number.isNaN(Number(trimmed))
        ? { value: null, problem: `"${trimmed}" isn't a number — left blank.` }
        : { value: Number(trimmed) };
    case "tags":
      return {
        value: trimmed
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      };
    case "date":
      // Stored as `YYYY-MM-DD`, the only form a date input shows. A spelling
      // toIsoDate doesn't know is kept as written rather than lost.
      return { value: toIsoDate(trimmed) ?? trimmed };
    default:
      return { value: trimmed };
  }
}

const FIXED_COLUMNS: Record<string, "verified" | "borrower" | "notes"> = {
  verified: "verified",
  borrower: "borrower",
  comments: "notes",
};

/**
 * Postgres takes at most 65,535 bind parameters per statement, and an item row
 * binds about seven, so one INSERT for a whole file breaks somewhere past 9,000
 * rows. A 5MB CSV can hold 40,000.
 */
const INSERT_CHUNK_ROWS = 500;

type CommitImportParams = {
  collectionId: string;
  fields: FieldDef[];
  mapping: ImportMappings; // csv header -> field id, or '__skip'
  rows: Record<string, string>[];
  /**
   * Import into a collection that already exists: `fields` is the list the
   * wizard loaded, which may be stale. Fields in it the collection doesn't have
   * yet are appended to the collection's *current* list, in the same
   * transaction as the rows — so a field someone else added or changed
   * meanwhile is kept, and a commit that fails adds no fields.
   */
  addNewFields?: boolean;
};

export async function commitImport(params: CommitImportParams) {
  const { collectionId, mapping, rows } = params;

  const [batch] = await db
    .insert(importBatches)
    .values({ collectionId, mapping, status: "staged" })
    .returning();

  // One transaction, so a chunk that fails takes the ones before it with it and
  // the batch stays "staged" rather than half-imported.
  return db.transaction(async (tx) => {
    let fields = params.fields;
    if (params.addNewFields) {
      const [current] = await tx
        .select({ fields: collections.fields })
        .from(collections)
        .where(eq(collections.id, collectionId))
        .for("update");
      if (!current) throw new Error("Collection not found.");

      const have = new Set(current.fields.map((f) => f.id));
      const added = params.fields
        .filter((f) => !have.has(f.id))
        .map((f, i) => ({ ...f, order: current.fields.length + i }));
      fields = [...current.fields, ...added];
      if (added.length > 0) {
        await tx.update(collections).set({ fields, updatedAt: sql`now()` }).where(eq(collections.id, collectionId));
      }
    }

    const { toInsert, errors } = buildRows(collectionId, batch.id, fields, mapping, rows);

    for (let start = 0; start < toInsert.length; start += INSERT_CHUNK_ROWS) {
      await tx.insert(items).values(toInsert.slice(start, start + INSERT_CHUNK_ROWS));
    }
    await tx
      .update(importBatches)
      .set({ status: "committed", errorReport: errors })
      .where(eq(importBatches.id, batch.id));

    return { batchId: batch.id, inserted: toInsert.length, errors };
  });
}

function buildRows(
  collectionId: string,
  batchId: string,
  fields: FieldDef[],
  mapping: ImportMappings,
  rows: Record<string, string>[],
) {
  const fieldById = new Map(fields.map((f, index) => [f.id, { field: f, index }]));
  const errors: ImportRowError[] = [];
  const toInsert: (typeof items.$inferInsert)[] = [];

  rows.forEach((row, rowIndex) => {
    let title: string | null = null;
    let verified = false;
    let borrower: string | null = null;
    let notes: string | null = null;
    const values: Record<string, unknown> = {};
    const problems: ImportRowError[] = [];

    for (const [header, targetId] of Object.entries(mapping)) {
      if (targetId === "__skip") continue;
      const target = fieldById.get(targetId);
      if (!target) continue;
      const raw = row[header] ?? "";

      if (isTitleField(target.index)) {
        title = raw.trim() || null;
        continue;
      }
      const { value: coerced, problem } = coerceCsvValue(target.field.type, raw);
      if (problem) problems.push({ row: rowIndex + 1, message: `${header}: ${problem}` });

      const column = FIXED_COLUMNS[target.field.id];
      if (column === "verified") verified = Boolean(coerced);
      else if (column === "borrower") borrower = coerced ? String(coerced) : null;
      else if (column === "notes") notes = coerced ? String(coerced) : null;
      else values[target.field.id] = coerced;
    }

    if (!title) {
      // The row isn't imported, so its cell-level problems don't matter.
      errors.push({ row: rowIndex + 1, message: "Missing title — row skipped." });
      return;
    }
    errors.push(...problems);

    toInsert.push({
      collectionId,
      title,
      verified,
      borrower,
      notes,
      values,
      importBatchId: batchId,
    });
  });

  return { toInsert, errors };
}

/**
 * Undoes one import into `collectionId`. A batch id from any other collection
 * matches nothing, so it is a no-op rather than a way to reach into a
 * collection the caller was never authorized against.
 */
export async function rollbackImportBatch(collectionId: string, batchId: string) {
  // An imported row starts without a cover, but nothing stops someone adding a
  // photo (or running a lookup) before deciding the whole batch was a mistake.
  const removed = await db
    .delete(items)
    .where(and(eq(items.importBatchId, batchId), eq(items.collectionId, collectionId)))
    .returning({ coverUrl: items.coverUrl });

  await db
    .update(importBatches)
    .set({ status: "rolled_back" })
    .where(and(eq(importBatches.id, batchId), eq(importBatches.collectionId, collectionId)));
  await releaseUploads(removed.map((row) => row.coverUrl));
}
