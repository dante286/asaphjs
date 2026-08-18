"use server";

import { requireSession } from "@/lib/auth/session";
import { resolveRole } from "@/db/queries/members";
import { getCollectionById } from "@/db/queries/collections";
import { getItem, patchItem } from "@/db/queries/items";
import { getProvider } from "@/lib/metadata/providers";
import { resolveLookupConfig } from "@/lib/metadata/lookup-config";
import { buildPrefillPlan } from "@/lib/metadata/prefill";
import { mirrorCover } from "@/lib/metadata/cover-mirror";
import { deleteUpload } from "@/lib/uploads/files";
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
 * and — where an item is involved — that the item really belongs to it.
 */
async function loadEditableCollection(collectionId: string) {
  const session = await requireSession();
  const role = await resolveRole(collectionId, session.user.id);
  if (role !== "owner" && role !== "editor") throw new Error("Not authorized.");

  const collection = await getCollectionById(collectionId);
  if (!collection) throw new Error("Collection not found.");

  const lookup = resolveLookupConfig(collection);
  if (!lookup) throw new Error("This collection has no metadata provider configured.");

  return { collection, lookup };
}

async function loadEditableItem(collectionId: string, itemId: string) {
  const { collection, lookup } = await loadEditableCollection(collectionId);

  const item = await getItem(itemId);
  if (!item || item.collectionId !== collectionId) throw new Error("Item not found.");

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

  // Serve the art ourselves when we can — see mirrorCover for why hotlinking it
  // reads as "the cover didn't apply". Falls back to the provider's URL.
  const mirrored = plan.patch.coverUrl ? await mirrorCover(plan.patch.coverUrl) : null;
  if (mirrored) plan.patch.coverUrl = mirrored;

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

  if (!result.ok) {
    // Don't leave mirrored bytes on disk for a row we didn't end up updating.
    if (mirrored) await deleteUpload(mirrored);
    if (result.reason === "conflict") throw new Error("This item changed elsewhere — reload and try again.");
    throw new Error("Item not found.");
  }

  // No-op unless the cover we replaced was itself stored locally — an uploaded
  // photo or an earlier mirror. Provider URLs are left alone.
  if (mirrored) await deleteUpload(item.coverUrl);

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

export type LookupDraftPreview = {
  /** The provider's own title, for a draft that doesn't have one typed yet. */
  title: string | null;
  values: Record<string, unknown>;
  /** The provider's URL — shown as a thumbnail only; the create route mirrors it. */
  coverUrl: string | null;
  /** Field labels the provider had data for, whether or not the draft uses them. */
  filled: string[];
};

// What buildPrefillPlan measures "is this field already filled in?" against when
// there is no row yet. The dialog does its own blank-only merge on top, so the
// plan is computed against a clean slate here rather than the half-typed draft.
const EMPTY_DRAFT = { title: "", verified: false, borrower: null, notes: null, values: {}, coverUrl: null };

/**
 * The hydrate half of a lookup for an item that doesn't exist yet — the create
 * dialog puts these values in the form so they can be reviewed and edited before
 * anything is written. Nothing is persisted and no cover is mirrored: a dialog
 * that gets cancelled shouldn't leave bytes on disk. Saving re-reads the same
 * (by then cached) hydrate payload from the items route.
 */
export async function previewLookupForDraftAction(input: {
  collectionId: string;
  sourceId: string;
}): Promise<LookupDraftPreview> {
  const { collection, lookup } = await loadEditableCollection(input.collectionId);

  const hydrated = await getProvider(lookup.key).hydrate(input.sourceId);
  const plan = buildPrefillPlan(collection.fields, EMPTY_DRAFT, hydrated);

  return {
    title: plan.patch.title ?? null,
    values: plan.patch.values ?? {},
    coverUrl: plan.patch.coverUrl ?? null,
    filled: plan.applied,
  };
}
