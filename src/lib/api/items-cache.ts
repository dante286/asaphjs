import type { QueryClient } from "@tanstack/react-query";

/**
 * Every cached items list for a collection, under any search or filter. The
 * collection view keys each one as `["items", collectionId, { q, verifiedOnly,
 * lentOnly }]`, so this prefix matches all of them.
 */
export function itemsQueryPrefix(collectionId: string) {
  return ["items", collectionId] as const;
}

/**
 * Marks a collection's cached lists stale after a change made somewhere other
 * than the list itself: the item page, an import, a delete. The app's
 * `staleTime` is 30 seconds, and the list's server-rendered `initialData` is
 * ignored once the cache has an entry, so without this, going back to the
 * collection could show a deleted row, or miss imported ones, for that long.
 *
 * `refetchType: "none"` because the lists usually aren't mounted at that
 * moment; each one refetches when it next mounts. Any that are mounted (the
 * other filters of the view that made the change) refetch then too.
 */
export function markItemsStale(queryClient: QueryClient, collectionId: string) {
  return queryClient.invalidateQueries({ queryKey: itemsQueryPrefix(collectionId), refetchType: "none" });
}
