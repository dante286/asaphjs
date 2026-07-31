import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { items } from "@/db/schema";
import type { FieldDef } from "@/lib/fields/field-def";

export type CollectionStats = {
  itemCount: number;
  verifiedCount: number;
  lentCount: number;
  distinctFacetCount: number | null;
  facetLabel: string | null;
};

/** Pick the field the breakdown panel groups by: the first select-type field. */
export function pickBreakdownField(fields: FieldDef[]): FieldDef | null {
  return fields.find((f) => f.type === "select") ?? null;
}

export async function getCollectionStats(
  collectionId: string,
  fields: FieldDef[],
): Promise<CollectionStats> {
  const facetField = pickBreakdownField(fields);

  const [row] = await db
    .select({
      itemCount: sql<number>`count(*)::int`,
      verifiedCount: sql<number>`count(*) filter (where ${items.verified})::int`,
      lentCount: sql<number>`count(*) filter (where ${items.borrower} is not null)::int`,
      distinctFacetCount: facetField
        ? sql<number>`count(distinct ${items.values}->>${facetField.id})::int`
        : sql<number>`null`,
    })
    .from(items)
    .where(eq(items.collectionId, collectionId));

  return {
    itemCount: row?.itemCount ?? 0,
    verifiedCount: row?.verifiedCount ?? 0,
    lentCount: row?.lentCount ?? 0,
    distinctFacetCount: facetField ? row?.distinctFacetCount ?? 0 : null,
    facetLabel: facetField?.label ?? null,
  };
}

export type BreakdownRow = { label: string; count: number };

export async function getBreakdown(
  collectionId: string,
  field: FieldDef,
  limit = 8,
): Promise<BreakdownRow[]> {
  const rows = await db
    .select({
      label: sql<string>`coalesce(${items.values}->>${field.id}, 'Unset')`,
      count: sql<number>`count(*)::int`,
    })
    .from(items)
    .where(eq(items.collectionId, collectionId))
    .groupBy(sql`1`)
    .orderBy(sql`2 desc`)
    .limit(limit);

  return rows;
}
