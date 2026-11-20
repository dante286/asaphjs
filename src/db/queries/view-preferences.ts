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
  const entries = Object.entries(patch.columnWidths ?? {});
  const merge = Object.fromEntries(entries.filter(([, width]) => width !== null)) as Record<string, number>;
  const remove = entries.filter(([, width]) => width === null).map(([colId]) => colId);

  // Merged in the database rather than read, merged here, and written back:
  // two resizes landing together would each write the widths they read, and
  // the later write would drop the earlier one's column.
  const base = patch.resetColumnWidths ? sql`'{}'::jsonb` : sql`${viewPreferences.columnWidths}`;
  const columnWidths = sql`(${base} || ${JSON.stringify(merge)}::jsonb) - ${sql.param(remove)}::text[]`;

  const [row] = await db
    .insert(viewPreferences)
    .values({ userId, collectionId, columnWidths: merge, hiddenColumns: patch.hiddenColumns ?? [] })
    .onConflictDoUpdate({
      target: [viewPreferences.userId, viewPreferences.collectionId],
      // Database clock, as everywhere else this column is written — see the
      // note on `touchedNow` in collections.ts.
      set: {
        columnWidths: columnWidths as unknown as Record<string, number>,
        ...(patch.hiddenColumns ? { hiddenColumns: patch.hiddenColumns } : {}),
        updatedAt: sql`now()`,
      },
    })
    .returning();

  return { columnWidths: row.columnWidths, hiddenColumns: row.hiddenColumns };
}
