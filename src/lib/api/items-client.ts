import type { ItemPatch } from "@/db/queries/items";
import type { items } from "@/db/schema";

// Dates cross the wire as ISO strings (JSON has no Date type), unlike the
// Date objects Drizzle returns server-side — this is the shape the client
// actually receives. Nullability is preserved per-field (updatedAt is never
// null; lentOn can be).
type DateToString<T> = T extends Date ? string : T extends null ? null : T;
type Serialized<T> = { [K in keyof T]: T[K] extends Date | null ? DateToString<T[K]> : T[K] };
export type Item = Serialized<typeof items.$inferSelect>;
export type ItemsPage = { rows: Item[]; total: number; page: number; pageSize: number };

/**
 * Server-rendered pages and Server Actions have to hand the client the same
 * shape a fetch() of the items API would — JSON.stringify does this implicitly
 * for route handlers, so anything returning rows directly does it here.
 */
export function toClientItem(row: typeof items.$inferSelect): Item {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lentOn: row.lentOn ? String(row.lentOn) : null,
  };
}

export type ItemsQuery = {
  q?: string;
  verifiedOnly?: boolean;
  lentOnly?: boolean;
};

export async function fetchItems(collectionId: string, query: ItemsQuery): Promise<ItemsPage> {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.verifiedOnly) params.set("verifiedOnly", "1");
  if (query.lentOnly) params.set("lentOnly", "1");

  const res = await fetch(`/api/collections/${collectionId}/items?${params.toString()}`);
  if (!res.ok) throw new Error("Failed to load items.");
  return res.json();
}

/** What the create dialog collects — everything an item needs to land complete. */
export type ItemDraft = {
  title: string;
  values?: Record<string, unknown>;
  verified?: boolean;
  borrower?: string | null;
  notes?: string | null;
  /** The provider candidate the draft was pre-filled from, if any. The server
      re-reads its cover and provenance rather than trusting them from here. */
  match?: { sourceId: string };
};

export async function createItemRequest(collectionId: string, draft: ItemDraft): Promise<Item> {
  const res = await fetch(`/api/collections/${collectionId}/items`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(draft),
  });
  if (!res.ok) throw await errorFrom(res, "Failed to create item.");
  return res.json();
}

export class ConflictError extends Error {
  current: Item;
  constructor(current: Item) {
    super("Item changed elsewhere.");
    this.current = current;
  }
}

/** Surfaces the route's own message (size cap, unsupported format) when there is one. */
async function errorFrom(res: Response, fallback: string): Promise<Error> {
  try {
    const body = await res.json();
    return new Error(typeof body?.error === "string" ? body.error : fallback);
  } catch {
    return new Error(fallback);
  }
}

export async function patchItemRequest(
  collectionId: string,
  itemId: string,
  patch: ItemPatch,
  ifMatchUpdatedAt: string,
): Promise<Item> {
  const res = await fetch(`/api/collections/${collectionId}/items/${itemId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "If-Match": ifMatchUpdatedAt },
    body: JSON.stringify(patch),
  });
  if (res.status === 409) {
    const body = await res.json();
    throw new ConflictError(body.current);
  }
  if (!res.ok) throw new Error("Failed to save.");
  return res.json();
}

export async function uploadItemPhotoRequest(
  collectionId: string,
  itemId: string,
  file: File,
  ifMatchUpdatedAt: string,
): Promise<Item> {
  const body = new FormData();
  body.append("photo", file);

  // No Content-Type header — the browser has to set the multipart boundary itself.
  const res = await fetch(`/api/collections/${collectionId}/items/${itemId}/photo`, {
    method: "POST",
    headers: { "If-Match": ifMatchUpdatedAt },
    body,
  });
  if (res.status === 409) {
    const payload = await res.json();
    throw new ConflictError(payload.current);
  }
  if (!res.ok) throw await errorFrom(res, "Failed to upload the photo.");
  return res.json();
}

export async function removeItemPhotoRequest(
  collectionId: string,
  itemId: string,
  ifMatchUpdatedAt: string,
): Promise<Item> {
  const res = await fetch(`/api/collections/${collectionId}/items/${itemId}/photo`, {
    method: "DELETE",
    headers: { "If-Match": ifMatchUpdatedAt },
  });
  if (res.status === 409) {
    const payload = await res.json();
    throw new ConflictError(payload.current);
  }
  if (!res.ok) throw await errorFrom(res, "Failed to remove the photo.");
  return res.json();
}

export async function deleteItemRequest(collectionId: string, itemId: string): Promise<void> {
  const res = await fetch(`/api/collections/${collectionId}/items/${itemId}`, { method: "DELETE" });
  if (!res.ok && res.status !== 204) throw new Error("Failed to delete item.");
}
