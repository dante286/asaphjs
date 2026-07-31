"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { fieldDefSchema } from "@/lib/fields/field-def";
import { createCollection } from "@/db/queries/collections";
import { commitImport, rollbackImportBatch } from "@/db/queries/imports";
import { updateCollectionFields, updateCollectionSettings } from "@/db/queries/collections";
import { resolveRole } from "@/db/queries/members";

const rowsSchema = z.array(z.record(z.string(), z.string()));
const mappingSchema = z.record(z.string(), z.string());

export async function importCsvIntoNewCollectionAction(input: {
  name: string;
  fields: z.infer<typeof fieldDefSchema>[];
  mapping: Record<string, string>;
  rows: Record<string, string>[];
  defaultView?: "covers" | "table";
  features?: { verified?: boolean; lending?: boolean };
}) {
  const session = await requireSession();
  const fields = z.array(fieldDefSchema).parse(input.fields);
  const mapping = mappingSchema.parse(input.mapping);
  const rows = rowsSchema.parse(input.rows);

  const collection = await createCollection({
    ownerId: session.user.id,
    name: input.name,
    templateKey: null,
    fields,
    defaultView: input.defaultView,
    features: input.features,
  });

  const result = await commitImport({ collectionId: collection.id, fields, mapping, rows });

  redirect(`/collections/${collection.slug}?imported=${result.inserted}`);
}

export async function importCsvIntoCollectionAction(input: {
  collectionId: string;
  fields: z.infer<typeof fieldDefSchema>[]; // full field list, including any newly added ones
  mapping: Record<string, string>;
  rows: Record<string, string>[];
}) {
  const session = await requireSession();
  const role = await resolveRole(input.collectionId, session.user.id);
  if (role !== "owner" && role !== "editor") throw new Error("Not authorized.");

  const fields = z.array(fieldDefSchema).parse(input.fields);
  const mapping = mappingSchema.parse(input.mapping);
  const rows = rowsSchema.parse(input.rows);

  await updateCollectionFields(input.collectionId, fields);
  await updateCollectionSettings(input.collectionId, { importMappings: mapping });

  return commitImport({ collectionId: input.collectionId, fields, mapping, rows });
}

export async function rollbackImportBatchAction(collectionId: string, batchId: string) {
  const session = await requireSession();
  const role = await resolveRole(collectionId, session.user.id);
  if (role !== "owner" && role !== "editor") throw new Error("Not authorized.");
  await rollbackImportBatch(batchId);
}
