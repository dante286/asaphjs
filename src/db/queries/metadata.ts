import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { metadataCache, metadataSearchCache } from "@/db/schema";

function normalizeQuery(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, " ");
}

export async function getCachedHydrate(source: string, sourceId: string) {
  return db.query.metadataCache.findFirst({
    where: and(eq(metadataCache.source, source), eq(metadataCache.sourceId, sourceId)),
  });
}

export async function setCachedHydrate(source: string, sourceId: string, payload: Record<string, unknown>) {
  await db
    .insert(metadataCache)
    .values({ source, sourceId, payload })
    .onConflictDoUpdate({
      target: [metadataCache.source, metadataCache.sourceId],
      set: { payload, fetchedAt: new Date() },
    });
}

export async function getCachedSearch(source: string, query: string) {
  return db.query.metadataSearchCache.findFirst({
    where: and(
      eq(metadataSearchCache.source, source),
      eq(metadataSearchCache.queryNormalized, normalizeQuery(query)),
    ),
  });
}

export async function setCachedSearch(source: string, query: string, payload: unknown) {
  await db
    .insert(metadataSearchCache)
    .values({ source, queryNormalized: normalizeQuery(query), payload })
    .onConflictDoUpdate({
      target: [metadataSearchCache.source, metadataSearchCache.queryNormalized],
      set: { payload, fetchedAt: new Date() },
    });
}
