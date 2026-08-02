import type { ViewPrefsPatch } from "@/db/queries/view-preferences";

export type ViewPrefs = { columnWidths: Record<string, number>; hiddenColumns: string[] };

export async function fetchViewPrefs(collectionId: string): Promise<ViewPrefs> {
  const res = await fetch(`/api/collections/${collectionId}/view-prefs`);
  if (!res.ok) throw new Error("Failed to load view preferences.");
  return res.json();
}

export async function saveViewPrefs(collectionId: string, patch: ViewPrefsPatch): Promise<ViewPrefs> {
  const res = await fetch(`/api/collections/${collectionId}/view-prefs`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error("Failed to save view preferences.");
  return res.json();
}
