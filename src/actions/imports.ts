"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { fieldDefSchema } from "@/lib/fields/field-def";
import { createCollection } from "@/db/queries/collections";
import { commitImport, rollbackImportBatch } from "@/db/queries/imports";
import { updateCollectionFields, updateCollectionSettings } from "@/db/queries/collections";
import { resolveRole } from "@/db/queries/members";
import { MAX_CSV_BYTES, csvTooLargeMessage } from "@/lib/csv/limits";
import { csvByteSize, fromCsvPayload, type CsvPayload } from "@/lib/csv/payload";

const csvSchema = z.object({ headers: z.array(z.string()), rows: z.array(z.object({ cells: z.array(z.string()) })) });
const mappingSchema = z.record(z.string(), z.string());

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
  const parsed = parseRows(input.csv);
  if ("error" in parsed) return parsed;
  const { rows } = parsed;

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
