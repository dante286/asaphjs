import { and, asc, desc, eq, ilike, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { items } from "@/db/schema";
import type { FieldDef } from "@/lib/fields/field-def";
import { deleteUploads } from "@/lib/uploads/files";
import type { ExternalRef } from "@/types";

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

/**
 * externalRef is provenance the server writes when a metadata lookup is applied
 * — never something a client sends, which is why it's separate from the
 * wire-facing ItemPatch the items PATCH route accepts.
 */
export type InternalItemPatch = ItemPatch & Partial<{ externalRef: ExternalRef | null }>;

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

/**
 * The whole row an item can be created with — the create dialog collects the
 * fixed columns and the generic `values` up front, so a new item lands complete
 * rather than as a bare title waiting to be opened and filled in.
 */
export type NewItem = {
  collectionId: string;
  title: string;
  values?: Record<string, unknown>;
  coverUrl?: string | null;
  verified?: boolean;
  borrower?: string | null;
  notes?: string | null;
  externalRef?: ExternalRef | null;
};

export async function createItem(params: NewItem) {
  const [row] = await db
    .insert(items)
    .values({
      collectionId: params.collectionId,
      title: params.title,
      values: params.values ?? {},
      coverUrl: params.coverUrl ?? null,
      verified: params.verified ?? false,
      borrower: params.borrower ?? null,
      notes: params.notes ?? null,
      externalRef: params.externalRef ?? null,
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
  patch: InternalItemPatch,
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
    if (patch.externalRef !== undefined) fixed.externalRef = patch.externalRef;

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

/**
 * Takes the item's cover file with it. Cleanup lives here rather than in the
 * route so it can't be forgotten by the next caller — a deleted item's photo is
 * unreachable from the app the moment its row is gone, and `uploads/` is a
 * mounted volume nobody sweeps. `deleteUploads` ignores provider URLs, so only
 * files this app wrote are touched.
 */
export async function deleteItem(itemId: string) {
  const removed = await db
    .delete(items)
    .where(eq(items.id, itemId))
    .returning({ coverUrl: items.coverUrl });

  await deleteUploads(removed.map((row) => row.coverUrl));
}

export async function getItem(itemId: string) {
  return db.query.items.findFirst({ where: eq(items.id, itemId) });
}

export type ItemNeighbors = { position: number; total: number; prevId: string | null; nextId: string | null };

/** Previous/next walk the collection's full title order, not the caller's current filter/search. */
export async function getItemNeighbors(collectionId: string, itemId: string): Promise<ItemNeighbors | null> {
  const result = await db.execute<{
    rn: number;
    total: number;
    prev_id: string | null;
    next_id: string | null;
  }>(sql`
    with ordered as (
      select id,
             row_number() over (order by sort_title) as rn,
             count(*) over () as total,
             lag(id) over (order by sort_title) as prev_id,
             lead(id) over (order by sort_title) as next_id
      from ${items}
      where collection_id = ${collectionId}
    )
    select rn, total, prev_id, next_id from ordered where id = ${itemId}
  `);

  const row = result.rows[0];
  if (!row) return null;

  return {
    position: Number(row.rn),
    total: Number(row.total),
    prevId: row.prev_id,
    nextId: row.next_id,
  };
}
