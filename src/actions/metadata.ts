"use server";

import { requireSession } from "@/lib/auth/session";
import { resolveRole } from "@/db/queries/members";
import { getCollectionById } from "@/db/queries/collections";
import { getItem, patchItem } from "@/db/queries/items";
import { getProvider } from "@/lib/metadata/providers";
import { resolveLookupConfig } from "@/lib/metadata/lookup-config";
import { buildPrefillPlan } from "@/lib/metadata/prefill";
import { toClientItem, type Item } from "@/lib/api/items-client";

export type LookupApplyResult = {
  item: Item;
  /** Field labels the lookup wrote, and the ones it left alone because they already had a value. */
  applied: string[];
  keptExisting: string[];
};

/**
 * Server Actions are reachable by POST regardless of what the UI renders, so
 * every one of these re-checks the session, the caller's role on the collection,
 * and that the item really belongs to that collection.
 */
async function loadEditableItem(collectionId: string, itemId: string) {
  const session = await requireSession();
  const role = await resolveRole(collectionId, session.user.id);
  if (role !== "owner" && role !== "editor") throw new Error("Not authorized.");

  const collection = await getCollectionById(collectionId);
  if (!collection) throw new Error("Collection not found.");

  const item = await getItem(itemId);
  if (!item || item.collectionId !== collectionId) throw new Error("Item not found.");

  const lookup = resolveLookupConfig(collection);
  if (!lookup) throw new Error("This collection has no metadata provider configured.");

  return { collection, item, lookup };
}

async function applyHydrated(
  collectionId: string,
  itemId: string,
  sourceId: string,
  opts: { overwrite: boolean; forceRefresh: boolean; ifMatchUpdatedAt?: string },
): Promise<LookupApplyResult> {
  const { collection, item, lookup } = await loadEditableItem(collectionId, itemId);

  const hydrated = await getProvider(lookup.key).hydrate(sourceId, { forceRefresh: opts.forceRefresh });
  const plan = buildPrefillPlan(collection.fields, item, hydrated, { overwrite: opts.overwrite });

  const result = await patchItem(
    itemId,
    {
      ...plan.patch,
      // Provenance for the detail page's "matched from" line, and what re-run
      // reads back so the owner never has to re-pick the same game.
      externalRef: { source: lookup.key, id: sourceId, fetchedAt: new Date().toISOString() },
    },
    opts.ifMatchUpdatedAt,
  );

  if (!result.ok && result.reason === "conflict") throw new Error("This item changed elsewhere — reload and try again.");
  if (!result.ok) throw new Error("Item not found.");

  return { item: toClientItem(result.item), applied: plan.applied, keptExisting: plan.keptExisting };
}

/** Applies the candidate the owner picked in the lookup panel. Fills blanks only unless `overwrite`. */
export async function applyLookupAction(input: {
  collectionId: string;
  itemId: string;
  sourceId: string;
  overwrite?: boolean;
  ifMatchUpdatedAt?: string;
}): Promise<LookupApplyResult> {
  return applyHydrated(input.collectionId, input.itemId, input.sourceId, {
    overwrite: input.overwrite ?? false,
    forceRefresh: false,
    ifMatchUpdatedAt: input.ifMatchUpdatedAt,
  });
}

/**
 * Re-fetches the already-matched source past the cache and overwrites the fields
 * it covers — the escape hatch for a match that was applied before the provider
 * had good data, or before a field existed on the collection.
 */
export async function rerunLookupAction(input: {
  collectionId: string;
  itemId: string;
  ifMatchUpdatedAt?: string;
}): Promise<LookupApplyResult> {
  const { item } = await loadEditableItem(input.collectionId, input.itemId);
  if (!item.externalRef) throw new Error("This item isn't matched to a provider yet.");

  return applyHydrated(input.collectionId, input.itemId, item.externalRef.id, {
    overwrite: true,
    forceRefresh: true,
    ifMatchUpdatedAt: input.ifMatchUpdatedAt,
  });
}

/** Drops the provenance link without touching the values it filled in. */
export async function clearLookupMatchAction(input: {
  collectionId: string;
  itemId: string;
  ifMatchUpdatedAt?: string;
}): Promise<Item> {
  await loadEditableItem(input.collectionId, input.itemId);

  const result = await patchItem(input.itemId, { externalRef: null }, input.ifMatchUpdatedAt);
  if (!result.ok && result.reason === "conflict") throw new Error("This item changed elsewhere — reload and try again.");
  if (!result.ok) throw new Error("Item not found.");

  return toClientItem(result.item);
}
