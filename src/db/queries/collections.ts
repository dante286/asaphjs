import { and, desc, eq, isNotNull, ne, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { collections, collectionMembers, items, user } from "@/db/schema";
import type { FieldDef } from "@/lib/fields/field-def";
import { deleteUploads } from "@/lib/uploads/files";
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

/**
 * One query: the slug identifies the collection, then ownership or an accepted
 * membership decides whether this user may have it. It used to look for one the
 * user owned first and only then for a shared one, which meant a collection
 * shared with you was unreachable whenever you owned one with the same slug —
 * and the shared branch resolved arbitrarily among several. The unique index on
 * `slug` is what makes both of those impossible: at most one row can match, so
 * this is a lookup rather than a choice.
 */
export async function getCollectionForUser(userId: string, slug: string) {
  const [row] = await db
    .select({ collection: collections })
    .from(collections)
    .leftJoin(
      collectionMembers,
      and(
        eq(collectionMembers.collectionId, collections.id),
        eq(collectionMembers.userId, userId),
        isNotNull(collectionMembers.acceptedAt),
      ),
    )
    .where(
      and(
        eq(collections.slug, slug),
        or(eq(collections.ownerId, userId), isNotNull(collectionMembers.acceptedAt)),
      ),
    )
    .limit(1);

  return row?.collection ?? null;
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

/**
 * Slugs are unique across the whole table (`collections_slug_unique`), so this
 * walks suffixes until it finds a free one. A small retry loop rather than a
 * DB-level upsert, which keeps the insert simple.
 *
 * Global rather than per-owner because `/collections/:slug` has no owner in it:
 * the path is resolved against whoever is viewing. When two owners could both
 * hold `movies`, `getCollectionForUser` answered with whichever one the viewer
 * owned, leaving a collection shared with them unreachable at its own URL.
 * Making the slug the unique thing moves that collision to where the app already
 * knows how to handle it — here.
 *
 * The trade: the second person to name a collection "Movies" gets
 * `/collections/movies-2`. Names like Movies and Books are exactly the ones two
 * people both use, so this fires far more often than the per-owner version did.
 * That's the price of a readable owner-free URL, and it's paid once at create or
 * rename rather than by a viewer who can't reach a collection at all.
 *
 * `excludeId` is for renames: a collection collides with its own row otherwise,
 * so renaming "Movies" to "Movies" (or back to a name it held before) would
 * creep to `movies-2` for no reason.
 */
async function uniqueSlug(name: string, excludeId?: string): Promise<string> {
  const base = slugify(name);
  let slug = base;
  let suffix = 1;
  for (;;) {
    const existing = await db.query.collections.findFirst({
      where: and(
        eq(collections.slug, slug),
        ...(excludeId ? [ne(collections.id, excludeId)] : []),
      ),
    });
    if (!existing) break;
    suffix += 1;
    slug = `${base}-${suffix}`;
  }
  return slug;
}

export async function createCollection(params: {
  ownerId: string;
  name: string;
  templateKey: string | null;
  fields: FieldDef[];
  defaultView?: "covers" | "table";
  features?: CollectionFeatures;
}) {
  const slug = await uniqueSlug(params.name);

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
  // The slug follows the name, and it does so here rather than in the action so
  // no future caller can rename a collection and leave its URL behind. Renaming
  // therefore changes the URL: links to the old slug 404. Share links are
  // token-based (`/s/:token`), so they survive a rename either way.
  const slug = patch.name === undefined ? undefined : await uniqueSlug(patch.name, id);

  const [row] = await db
    .update(collections)
    .set({ ...patch, ...(slug ? { slug } : {}), updatedAt: new Date() })
    .where(eq(collections.id, id))
    .returning();
  return row;
}

export async function deleteCollection(id: string) {
  // Items go with the collection via `on delete cascade`, which the app never
  // sees row by row — so their covers have to be read before the rows vanish.
  const covers = await db
    .select({ coverUrl: items.coverUrl })
    .from(items)
    .where(eq(items.collectionId, id));

  await db.delete(collections).where(eq(collections.id, id));
  await deleteUploads(covers.map((row) => row.coverUrl));
}
