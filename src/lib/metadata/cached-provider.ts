import type { Candidate, HydratedFields, MetadataProvider } from "./types";
import { getCachedHydrate, setCachedHydrate, getCachedSearch, setCachedSearch } from "@/db/queries/metadata";

// Hydrate results never expire: box art, publisher and platform don't change
// once something ships, and the only bypass is forceRefresh, which the item
// detail page's "Re-run lookup" button sets. Search results do expire — a query
// that matched nothing (or missed a game announced since) shouldn't be wrong
// forever — but slowly, because re-running searches is what burns the free tier.
const SEARCH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Stamped into every cached hydrate payload. Bump it whenever a provider changes
 * which canonical keys it returns: hydrate rows never expire, so without this a
 * payload cached under the old shape would keep filling items from data the
 * provider no longer returns that way, and only "Re-run lookup" would ever fix
 * it. A version mismatch is treated as a cache miss.
 *
 * 2 — Open Library gained author/publisher/series/summary and a cover that
 *     falls back to the search index.
 */
const PAYLOAD_SCHEMA_VERSION = 2;
const SCHEMA_KEY = "__schema";

function stampSchema(fields: HydratedFields): Record<string, unknown> {
  return { ...fields, [SCHEMA_KEY]: PAYLOAD_SCHEMA_VERSION };
}

/** Null when the row predates the current payload shape — the caller refetches. */
function readStamped(payload: Record<string, unknown>): HydratedFields | null {
  if (payload[SCHEMA_KEY] !== PAYLOAD_SCHEMA_VERSION) return null;
  const fields = { ...payload };
  delete fields[SCHEMA_KEY];
  return fields as HydratedFields;
}

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
        const fields = cached ? readStamped(cached.payload) : null;
        if (fields) return fields;
      }

      return single(`hydrate:${provider.key}:${sourceId}:${opts?.forceRefresh ? "fresh" : "cached"}`, async () => {
        const fields = await provider.hydrate(sourceId);
        await setCachedHydrate(provider.key, sourceId, stampSchema(fields));
        return fields;
      });
    },
  };
}
