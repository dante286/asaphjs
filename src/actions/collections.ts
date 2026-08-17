"use server";

import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { fieldDefSchema } from "@/lib/fields/field-def";
import { providerKeySchema } from "@/lib/metadata/types";
import { z } from "zod";
import {
  createCollection as createCollectionQuery,
  deleteCollection as deleteCollectionQuery,
  getCollectionById,
  updateCollectionFields as updateCollectionFieldsQuery,
  updateCollectionSettings as updateCollectionSettingsQuery,
} from "@/db/queries/collections";
import { resolveRole } from "@/db/queries/members";

const createCollectionSchema = z.object({
  name: z.string().min(1),
  templateKey: z.string().nullable(),
  fields: z.array(fieldDefSchema).min(1),
  defaultView: z.enum(["covers", "table"]).default("covers"),
  features: z
    .object({
      lending: z.boolean().optional(),
      verified: z.boolean().optional(),
      // Overrides the provider the template would default to (lookup-config.ts).
      lookup: providerKeySchema.optional(),
    })
    .optional(),
});

export async function createCollectionAction(input: z.infer<typeof createCollectionSchema>) {
  const session = await requireSession();
  const parsed = createCollectionSchema.parse(input);

  const collection = await createCollectionQuery({
    ownerId: session.user.id,
    name: parsed.name,
    templateKey: parsed.templateKey,
    fields: parsed.fields,
    defaultView: parsed.defaultView,
    features: parsed.features,
  });

  redirect(`/collections/${collection.slug}`);
}

async function requireEditorOrOwner(collectionId: string, userId: string) {
  const role = await resolveRole(collectionId, userId);
  if (role !== "owner" && role !== "editor") throw new Error("Not authorized.");
  return role;
}

async function requireOwner(collectionId: string, userId: string) {
  const role = await resolveRole(collectionId, userId);
  if (role !== "owner") throw new Error("Only the owner can do that.");
}

export async function updateFieldsAction(
  collectionId: string,
  fields: z.infer<typeof fieldDefSchema>[],
) {
  const session = await requireSession();
  await requireEditorOrOwner(collectionId, session.user.id);
  const parsedFields = z.array(fieldDefSchema).parse(fields);
  await updateCollectionFieldsQuery(collectionId, parsedFields);
}

export async function updateCollectionSettingsAction(
  collectionId: string,
  patch: Parameters<typeof updateCollectionSettingsQuery>[1],
) {
  const session = await requireSession();
  await requireOwner(collectionId, session.user.id);
  await updateCollectionSettingsQuery(collectionId, patch);
}

export async function deleteCollectionAction(collectionId: string) {
  const session = await requireSession();
  await requireOwner(collectionId, session.user.id);
  await deleteCollectionQuery(collectionId);
  redirect("/");
}

export async function getCollectionOr404(collectionId: string) {
  const collection = await getCollectionById(collectionId);
  if (!collection) throw new Error("Collection not found.");
  return collection;
}
