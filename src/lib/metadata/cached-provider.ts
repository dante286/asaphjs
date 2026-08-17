import type { Candidate, HydratedFields, MetadataProvider } from "./types";
import { getCachedHydrate, setCachedHydrate, getCachedSearch, setCachedSearch } from "@/db/queries/metadata";

// Hydrate results never expire: box art, publisher and platform don't change
// once something ships, and the only bypass is forceRefresh, which the item
// detail page's "Re-run lookup" button sets. Search results do expire — a query
// that matched nothing (or missed a game announced since) shouldn't be wrong
// forever — but slowly, because re-running searches is what burns the free tier.
const SEARCH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type CachedProvider = Omit<MetadataProvider, "hydrate"> & {
  hydrate: (sourceId: string, opts?: { forceRefresh?: boolean }) => Promise<HydratedFields>;
};

/**
 * Collapses concurrent identical calls onto one upstream request. Without this,
 * a search-as-you-type UI that fires "chrono", "chrono t", "chrono tr" and then
 * repeats a query still in flight pays for every one of them — the DB cache only
 * helps once the first response has landed.
 */
const inFlight = new Map<string, Promise<unknown>>();

function single<T>(key: string, work: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const promise = work().finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

export function withCache(provider: MetadataProvider): CachedProvider {
  return {
    key: provider.key,

    async search(query) {
      const cached = await getCachedSearch(provider.key, query);
      if (cached && Date.now() - cached.fetchedAt.getTime() < SEARCH_TTL_MS) {
        return cached.payload as Candidate[];
      }

      return single(`search:${provider.key}:${query.trim().toLowerCase()}`, async () => {
        const results = await provider.search(query);
        await setCachedSearch(provider.key, query, results); // empties too — stops re-hammering unmatched titles
        return results;
      });
    },

    async hydrate(sourceId, opts) {
      if (!opts?.forceRefresh) {
        const cached = await getCachedHydrate(provider.key, sourceId);
        if (cached) return cached.payload as HydratedFields;
      }

      return single(`hydrate:${provider.key}:${sourceId}:${opts?.forceRefresh ? "fresh" : "cached"}`, async () => {
        const fields = await provider.hydrate(sourceId);
        await setCachedHydrate(provider.key, sourceId, fields);
        return fields;
      });
    },
  };
}
