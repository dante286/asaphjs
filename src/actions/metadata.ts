"use server";

import { requireSession } from "@/lib/auth/session";
import { resolveRole } from "@/db/queries/members";
import { getCollectionById } from "@/db/queries/collections";
import { patchItem } from "@/db/queries/items";
import { getProvider } from "@/lib/metadata/providers";
import { providerKeySchema } from "@/lib/metadata/types";

export async function rerunLookupAction(collectionId: string, itemId: string, sourceId: string) {
  const session = await requireSession();
  const role = await resolveRole(collectionId, session.user.id);
  if (role !== "owner" && role !== "editor") throw new Error("Not authorized.");

  const collection = await getCollectionById(collectionId);
  if (!collection) throw new Error("Collection not found.");

  const providerKey = providerKeySchema.parse(collection.features.lookup);
  const { coverUrl, ...rest } = await getProvider(providerKey).hydrate(sourceId, { forceRefresh: true });

  return patchItem(itemId, { coverUrl, values: rest });
}
