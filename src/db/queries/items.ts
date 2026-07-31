import { and, asc, desc, eq, ilike, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { items } from "@/db/schema";
import type { FieldDef } from "@/lib/fields/field-def";

/**
 * The single place the public-share stripping rule is enforced — used by
 * both the `/s/:token` page and the items API route when role === 'public',
 * so a leak in one path can't happen without the other catching it too.
 */
export function stripItemsForPublic<T extends { borrower: unknown; notes: unknown; values: Record<string, unknown> }>(
  rows: T[],
  fields: FieldDef[],
): T[] {
  const privateFieldIds = new Set(fields.filter((f) => f.private).map((f) => f.id));
  return rows.map((row) => ({
    ...row,
    borrower: null,
    notes: null,
    values: Object.fromEntries(Object.entries(row.values).filter(([key]) => !privateFieldIds.has(key))),
  }));
}

export type ItemPatch = Partial<{
  title: string;
  coverUrl: string | null;
  verified: boolean;
  borrower: string | null;
  lentOn: string | null;
  notes: string | null;
  values: Record<string, unknown | null>; // null value => delete that key
}>;

export type ListItemsParams = {
  collectionId: string;
  q?: string;
  verifiedOnly?: boolean;
  lentOnly?: boolean;
  sort?: "title" | "updated";
  page?: number;
  pageSize?: number;
};

export async function listItems(params: ListItemsParams) {
  const pageSize = params.pageSize ?? 60;
  const page = params.page ?? 1;

  const conditions = [eq(items.collectionId, params.collectionId)];
  if (params.q) conditions.push(ilike(items.title, `%${params.q}%`));
  if (params.verifiedOnly) conditions.push(eq(items.verified, true));
  if (params.lentOnly) conditions.push(isNotNull(items.borrower));

  const where = and(...conditions);
  const orderBy = params.sort === "updated" ? desc(items.updatedAt) : asc(items.sortTitle);

  const [rows, [{ count }]] = await Promise.all([
    db
      .select()
      .from(items)
      .where(where)
      .orderBy(orderBy)
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ count: sql<number>`count(*)::int` }).from(items).where(where),
  ]);

  return { rows, total: count, page, pageSize };
}

export async function createItem(params: {
  collectionId: string;
  title: string;
  values?: Record<string, unknown>;
}) {
  const [row] = await db
    .insert(items)
    .values({
      collectionId: params.collectionId,
      title: params.title,
      values: params.values ?? {},
    })
    .returning();
  return row;
}

export type PatchResult =
  | { ok: true; item: typeof items.$inferSelect }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "conflict"; current: typeof items.$inferSelect };

export async function patchItem(
  itemId: string,
  patch: ItemPatch,
  ifMatchUpdatedAt?: string,
): Promise<PatchResult> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(items)
      .where(eq(items.id, itemId))
      .for("update");

    if (!current) return { ok: false, reason: "not_found" };

    if (ifMatchUpdatedAt && current.updatedAt.toISOString() !== ifMatchUpdatedAt) {
      return { ok: false, reason: "conflict", current };
    }

    const fixed: Record<string, unknown> = {};
    if (patch.title !== undefined) fixed.title = patch.title;
    if (patch.coverUrl !== undefined) fixed.coverUrl = patch.coverUrl;
    if (patch.verified !== undefined) fixed.verified = patch.verified;
    if (patch.borrower !== undefined) fixed.borrower = patch.borrower;
    if (patch.lentOn !== undefined) fixed.lentOn = patch.lentOn;
    if (patch.notes !== undefined) fixed.notes = patch.notes;

    let valuesExpr = items.values;
    if (patch.values) {
      const mergeObj = Object.fromEntries(
        Object.entries(patch.values).filter(([, v]) => v !== null),
      );
      const deleteKeys = Object.entries(patch.values)
        .filter(([, v]) => v === null)
        .map(([k]) => k);

      valuesExpr = sql`(${items.values} || ${JSON.stringify(mergeObj)}::jsonb) - ${sql.param(deleteKeys)}::text[]` as unknown as typeof items.values;
    }

    const [updated] = await tx
      .update(items)
      .set({ ...fixed, values: valuesExpr, updatedAt: new Date() })
      .where(eq(items.id, itemId))
      .returning();

    return { ok: true, item: updated };
  });
}

export async function deleteItem(itemId: string) {
  await db.delete(items).where(eq(items.id, itemId));
}

export async function getItem(itemId: string) {
  return db.query.items.findFirst({ where: eq(items.id, itemId) });
}
