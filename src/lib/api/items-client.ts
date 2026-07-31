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

export async function createItemRequest(collectionId: string, title: string): Promise<Item> {
  const res = await fetch(`/api/collections/${collectionId}/items`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error("Failed to create item.");
  return res.json();
}

export class ConflictError extends Error {
  current: Item;
  constructor(current: Item) {
    super("Item changed elsewhere.");
    this.current = current;
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

export async function deleteItemRequest(collectionId: string, itemId: string): Promise<void> {
  const res = await fetch(`/api/collections/${collectionId}/items/${itemId}`, { method: "DELETE" });
  if (!res.ok && res.status !== 204) throw new Error("Failed to delete item.");
}
