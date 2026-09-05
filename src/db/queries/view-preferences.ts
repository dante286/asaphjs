import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { viewPreferences } from "@/db/schema";

export type ViewPrefsPatch = Partial<{
  // A column id mapped to `null` deletes that column's override (auto-fit);
  // otherwise widths are merged in, same "null = delete" convention as
  // `ItemPatch.values` in db/queries/items.ts.
  columnWidths: Record<string, number | null>;
  hiddenColumns: string[];
  resetColumnWidths: boolean; // "Reset widths" — clears every override at once
}>;

const DEFAULT_PREFS = { columnWidths: {} as Record<string, number>, hiddenColumns: [] as string[] };

export async function getViewPreferences(userId: string, collectionId: string) {
  const row = await db.query.viewPreferences.findFirst({
    where: and(eq(viewPreferences.userId, userId), eq(viewPreferences.collectionId, collectionId)),
  });
  if (!row) return DEFAULT_PREFS;
  return { columnWidths: row.columnWidths, hiddenColumns: row.hiddenColumns };
}

export async function upsertViewPreferences(
  userId: string,
  collectionId: string,
  patch: ViewPrefsPatch,
) {
  const existing = await getViewPreferences(userId, collectionId);

  const columnWidths: Record<string, number> = patch.resetColumnWidths ? {} : { ...existing.columnWidths };
  if (patch.columnWidths) {
    for (const [colId, width] of Object.entries(patch.columnWidths)) {
      if (width === null) delete columnWidths[colId];
      else columnWidths[colId] = width;
    }
  }
  const hiddenColumns = patch.hiddenColumns ?? existing.hiddenColumns;

  const [row] = await db
    .insert(viewPreferences)
    .values({ userId, collectionId, columnWidths, hiddenColumns })
    .onConflictDoUpdate({
      target: [viewPreferences.userId, viewPreferences.collectionId],
      // Database clock, as everywhere else this column is written — see the
      // note on `touchedNow` in collections.ts.
      set: { columnWidths, hiddenColumns, updatedAt: sql`now()` },
    })
    .returning();

  return { columnWidths: row.columnWidths, hiddenColumns: row.hiddenColumns };
}
