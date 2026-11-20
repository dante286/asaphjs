"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { fieldDefSchema } from "@/lib/fields/field-def";
import { createCollection } from "@/db/queries/collections";
import { commitImport, rollbackImportBatch } from "@/db/queries/imports";
import { updateCollectionSettings } from "@/db/queries/collections";
import { resolveRole } from "@/db/queries/members";
import { MAX_CSV_BYTES, csvTooLargeMessage } from "@/lib/csv/limits";
import { csvByteSize, fromCsvPayload, type CsvPayload } from "@/lib/csv/payload";

const csvSchema = z.object({ headers: z.array(z.string()), rows: z.array(z.object({ cells: z.array(z.string()) })) });
const mappingSchema = z.record(z.string(), z.string());

/** What else the new-collection import takes from the client, parsed like `createCollectionAction`'s. */
const newCollectionSettingsSchema = z.object({
  name: z.string().trim().min(1).max(120),
  defaultView: z.enum(["covers", "table"]).optional(),
  features: z.object({ verified: z.boolean().optional(), lending: z.boolean().optional() }).optional(),
});

/**
 * The picker turns away a file over the cap before it's read, but the action is
 * a public endpoint. The size comes back as a value rather than a throw, since
 * a production build replaces thrown messages with a generic one.
 */
function parseRows(input: CsvPayload): { rows: Record<string, string>[] } | { error: string } {
  const csv = csvSchema.parse(input);
  if (csvByteSize(csv) > MAX_CSV_BYTES) return { error: csvTooLargeMessage() };
  return { rows: fromCsvPayload(csv) };
}

export async function importCsvIntoNewCollectionAction(input: {
  name: string;
  fields: z.infer<typeof fieldDefSchema>[];
  mapping: Record<string, string>;
  csv: CsvPayload;
  defaultView?: "covers" | "table";
  features?: { verified?: boolean; lending?: boolean };
}) {
  const session = await requireSession();
  const fields = z.array(fieldDefSchema).parse(input.fields);
  const mapping = mappingSchema.parse(input.mapping);
  const settings = newCollectionSettingsSchema.parse({
    name: input.name,
    defaultView: input.defaultView,
    features: input.features,
  });
  const parsed = parseRows(input.csv);
  if ("error" in parsed) return parsed;
  const { rows } = parsed;

  const collection = await createCollection({
    ownerId: session.user.id,
    name: settings.name,
    templateKey: null,
    fields,
    defaultView: settings.defaultView,
    features: settings.features,
  });

  const result = await commitImport({ collectionId: collection.id, fields, mapping, rows });

  redirect(`/collections/${collection.slug}?imported=${result.inserted}`);
}

export async function importCsvIntoCollectionAction(input: {
  collectionId: string;
  fields: z.infer<typeof fieldDefSchema>[]; // full field list, including any newly added ones
  mapping: Record<string, string>;
  csv: CsvPayload;
}) {
  const session = await requireSession();
  const role = await resolveRole(input.collectionId, session.user.id);
  if (role !== "owner" && role !== "editor") throw new Error("Not authorized.");

  const fields = z.array(fieldDefSchema).parse(input.fields);
  const mapping = mappingSchema.parse(input.mapping);
  const parsed = parseRows(input.csv);
  if ("error" in parsed) return parsed;
  const { rows } = parsed;

  // An import only ever adds fields, and commitImport adds them to the
  // collection's current list inside the rows' transaction: this list was
  // loaded when the page rendered, so writing it back whole would undo field
  // edits made since, and writing it first would keep the fields even if the
  // rows then failed.
  const result = await commitImport({ collectionId: input.collectionId, fields, mapping, rows, addNewFields: true });
  // Only once the rows are in, so a failed import doesn't remember its mapping.
  await updateCollectionSettings(input.collectionId, { importMappings: mapping });
  return result;
}

export async function rollbackImportBatchAction(collectionId: string, batchId: string) {
  const session = await requireSession();
  const role = await resolveRole(collectionId, session.user.id);
  if (role !== "owner" && role !== "editor") throw new Error("Not authorized.");
  await rollbackImportBatch(collectionId, batchId);
}
