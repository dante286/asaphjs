import type { Candidate, ProviderKey } from "@/lib/metadata/types";

/** Below this the provider has nothing useful to match on, and the request is pure quota burn. */
export const MIN_LOOKUP_QUERY_LENGTH = 2;

export async function searchLookupRequest(
  provider: ProviderKey,
  query: string,
  signal?: AbortSignal,
): Promise<Candidate[]> {
  const res = await fetch(`/api/lookup/${provider}/search?q=${encodeURIComponent(query)}`, { signal });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(typeof body?.error === "string" ? body.error : "Lookup failed.");
  }
  return res.json();
}
