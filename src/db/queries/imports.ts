import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { importBatches, items } from "@/db/schema";
import type { ImportRowError } from "@/db/schema/import-batches";
import type { FieldDef } from "@/lib/fields/field-def";
import { isTitleField } from "@/lib/fields/item-values";
import { deleteUploads } from "@/lib/uploads/files";
import type { ImportMappings } from "@/types";

const TRUE_VALUES = new Set(["y", "yes", "true", "1"]);

function coerceCsvValue(type: FieldDef["type"], raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === "") return null;

  switch (type) {
    case "checkbox":
      return TRUE_VALUES.has(trimmed.toLowerCase());
    case "number":
      return Number.isNaN(Number(trimmed)) ? null : Number(trimmed);
    case "tags":
      return trimmed
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    default:
      return trimmed;
  }
}

const FIXED_COLUMNS: Record<string, "verified" | "borrower" | "notes"> = {
  verified: "verified",
  borrower: "borrower",
  comments: "notes",
};

export type CommitImportParams = {
  collectionId: string;
  fields: FieldDef[];
  mapping: ImportMappings; // csv header -> field id, or '__skip'
  rows: Record<string, string>[];
};

export async function commitImport(params: CommitImportParams) {
  const { collectionId, fields, mapping, rows } = params;
  const fieldById = new Map(fields.map((f, index) => [f.id, { field: f, index }]));

  const [batch] = await db
    .insert(importBatches)
    .values({ collectionId, mapping, status: "staged" })
    .returning();

  const errors: ImportRowError[] = [];
  const toInsert: (typeof items.$inferInsert)[] = [];

  rows.forEach((row, rowIndex) => {
    let title: string | null = null;
    let verified = false;
    let borrower: string | null = null;
    let notes: string | null = null;
    const values: Record<string, unknown> = {};

    for (const [header, targetId] of Object.entries(mapping)) {
      if (targetId === "__skip") continue;
      const target = fieldById.get(targetId);
      if (!target) continue;
      const raw = row[header] ?? "";
      const coerced = coerceCsvValue(target.field.type, raw);

      if (isTitleField(target.index)) {
        title = raw.trim() || null;
        continue;
      }
      const column = FIXED_COLUMNS[target.field.id];
      if (column === "verified") verified = Boolean(coerced);
      else if (column === "borrower") borrower = coerced ? String(coerced) : null;
      else if (column === "notes") notes = coerced ? String(coerced) : null;
      else values[target.field.id] = coerced;
    }

    if (!title) {
      errors.push({ row: rowIndex + 1, message: "Missing title — row skipped." });
      return;
    }

    toInsert.push({
      collectionId,
      title,
      verified,
      borrower,
      notes,
      values,
      importBatchId: batch.id,
    });
  });

  if (toInsert.length > 0) {
    await db.insert(items).values(toInsert);
  }

  await db
    .update(importBatches)
    .set({ status: "committed", errorReport: errors })
    .where(eq(importBatches.id, batch.id));

  return { batchId: batch.id, inserted: toInsert.length, errors };
}

export async function rollbackImportBatch(batchId: string) {
  // An imported row starts without a cover, but nothing stops someone adding a
  // photo (or running a lookup) before deciding the whole batch was a mistake.
  const removed = await db
    .delete(items)
    .where(eq(items.importBatchId, batchId))
    .returning({ coverUrl: items.coverUrl });

  await db.update(importBatches).set({ status: "rolled_back" }).where(eq(importBatches.id, batchId));
  await deleteUploads(removed.map((row) => row.coverUrl));
}
