import type { Candidate, HydratedFields, MetadataProvider } from "./types";
import { getCachedHydrate, setCachedHydrate, getCachedSearch, setCachedSearch } from "@/db/queries/metadata";

// No TTL — box art and publisher don't change once something ships, so the
// cache is indefinite. The only bypass is forceRefresh, which the item detail
// page's "Re-run lookup" button sets.
type CachedProvider = Omit<MetadataProvider, "hydrate"> & {
  hydrate: (sourceId: string, opts?: { forceRefresh?: boolean }) => Promise<HydratedFields>;
};

export function withCache(provider: MetadataProvider): CachedProvider {
  return {
    key: provider.key,
    async search(query) {
      const cached = await getCachedSearch(provider.key, query);
      if (cached) return cached.payload as Candidate[];
      const results = await provider.search(query);
      await setCachedSearch(provider.key, query, results); // cache empties too — stops re-hammering unmatched titles
      return results;
    },
    async hydrate(sourceId, opts) {
      if (!opts?.forceRefresh) {
        const cached = await getCachedHydrate(provider.key, sourceId);
        if (cached) return cached.payload as HydratedFields;
      }
      const fields = await provider.hydrate(sourceId);
      await setCachedHydrate(provider.key, sourceId, fields);
      return fields;
    },
  };
}
