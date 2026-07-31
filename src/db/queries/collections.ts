import { and, desc, eq, isNotNull, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { collections, collectionMembers, items, user } from "@/db/schema";
import type { FieldDef } from "@/lib/fields/field-def";
import type { CollectionFeatures, ImportMappings } from "@/types";

export type CollectionCardRow = {
  collection: typeof collections.$inferSelect;
  ownerName: string | null;
  isOwner: boolean;
  itemCount: number;
  verifiedCount: number;
  lentCount: number;
};

/** One grouped query: every collection the user owns or has accepted access to, with counts. */
export async function listCollectionsForUser(userId: string): Promise<CollectionCardRow[]> {
  const rows = await db
    .select({
      collection: collections,
      ownerName: user.name,
      itemCount: sql<number>`count(${items.id})::int`,
      verifiedCount: sql<number>`count(*) filter (where ${items.verified})::int`,
      lentCount: sql<number>`count(*) filter (where ${items.borrower} is not null)::int`,
    })
    .from(collections)
    .innerJoin(user, eq(user.id, collections.ownerId))
    .leftJoin(items, eq(items.collectionId, collections.id))
    .leftJoin(
      collectionMembers,
      and(
        eq(collectionMembers.collectionId, collections.id),
        eq(collectionMembers.userId, userId),
      ),
    )
    .where(
      or(eq(collections.ownerId, userId), isNotNull(collectionMembers.acceptedAt)),
    )
    .groupBy(collections.id, user.name)
    .orderBy(desc(collections.updatedAt));

  return rows.map((r) => ({ ...r, isOwner: r.collection.ownerId === userId }));
}

export async function getCollectionForUser(userId: string, slug: string) {
  const owned = await db.query.collections.findFirst({
    where: and(eq(collections.ownerId, userId), eq(collections.slug, slug)),
  });
  if (owned) return owned;

  const [shared] = await db
    .select({ collection: collections })
    .from(collections)
    .innerJoin(
      collectionMembers,
      and(
        eq(collectionMembers.collectionId, collections.id),
        eq(collectionMembers.userId, userId),
        isNotNull(collectionMembers.acceptedAt),
      ),
    )
    .where(eq(collections.slug, slug))
    .limit(1);

  return shared?.collection ?? null;
}

export async function listOwnedCollections(userId: string) {
  return db.query.collections.findMany({
    where: eq(collections.ownerId, userId),
    orderBy: (c, { asc }) => [asc(c.name)],
  });
}

export async function getCollectionById(id: string) {
  return db.query.collections.findFirst({ where: eq(collections.id, id) });
}

export async function getCollectionByShareToken(token: string) {
  return db.query.collections.findFirst({
    where: and(eq(collections.shareToken, token), eq(collections.shareEnabled, true)),
  });
}

function slugify(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "collection"
  );
}

export async function createCollection(params: {
  ownerId: string;
  name: string;
  templateKey: string | null;
  fields: FieldDef[];
  defaultView?: "covers" | "table";
  features?: CollectionFeatures;
}) {
  const base = slugify(params.name);
  let slug = base;
  let suffix = 1;
  // Small retry loop rather than a DB-level upsert — collisions are rare
  // (one owner naming two collections the same) and this keeps the insert simple.
  for (;;) {
    const existing = await db.query.collections.findFirst({
      where: and(eq(collections.ownerId, params.ownerId), eq(collections.slug, slug)),
    });
    if (!existing) break;
    suffix += 1;
    slug = `${base}-${suffix}`;
  }

  const [row] = await db
    .insert(collections)
    .values({
      ownerId: params.ownerId,
      name: params.name,
      slug,
      templateKey: params.templateKey,
      fields: params.fields,
      defaultView: params.defaultView ?? "covers",
      features: params.features ?? {},
    })
    .returning();

  return row;
}

export async function updateCollectionFields(id: string, fields: FieldDef[]) {
  const [row] = await db
    .update(collections)
    .set({ fields, updatedAt: new Date() })
    .where(eq(collections.id, id))
    .returning();
  return row;
}

export async function updateCollectionSettings(
  id: string,
  patch: Partial<{
    name: string;
    defaultView: "covers" | "table";
    features: CollectionFeatures;
    shareEnabled: boolean;
    shareToken: string | null;
    importMappings: ImportMappings;
  }>,
) {
  const [row] = await db
    .update(collections)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(collections.id, id))
    .returning();
  return row;
}

export async function deleteCollection(id: string) {
  await db.delete(collections).where(eq(collections.id, id));
}
