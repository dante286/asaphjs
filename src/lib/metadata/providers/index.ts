import { withCache } from "../cached-provider";
import { igdbProvider } from "./igdb";
import { openLibraryProvider } from "./openlibrary";
import type { ProviderKey } from "../types";

// tmdb, musicbrainz, rebrickable follow this exact shape — add them here
// once keys exist. Not part of this pass.
const rawProviders = { igdb: igdbProvider, openlibrary: openLibraryProvider } as const;
const registry = Object.fromEntries(Object.entries(rawProviders).map(([k, p]) => [k, withCache(p)]));

export function getProvider(key: ProviderKey) {
  const provider = registry[key as keyof typeof registry];
  if (!provider) throw new Error(`No metadata provider configured for "${key}"`);
  return provider;
}
