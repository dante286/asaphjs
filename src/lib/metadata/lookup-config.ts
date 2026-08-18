import { providerKeySchema, type ProviderKey } from "./types";
import { isIgdbConfigured } from "./providers/igdb";
import { isTmdbConfigured } from "./providers/tmdb";
import type { CollectionFeatures } from "@/types";

export const PROVIDER_LABELS: Record<ProviderKey, string> = {
  igdb: "IGDB",
  openlibrary: "Open Library",
  tmdb: "TMDB",
  musicbrainz: "MusicBrainz",
  rebrickable: "Rebrickable",
};

/**
 * A collection's provider when `features.lookup` doesn't name one, keyed by the
 * template it was created from (templateKey is slugifyFieldLabel of the template
 * name). Templates with no entry get no lookup UI at all — better than pointing
 * Legos at a provider that only knows games.
 */
const TEMPLATE_DEFAULT_PROVIDER: Record<string, ProviderKey> = {
  video_games: "igdb",
  books: "openlibrary",
  comics: "openlibrary",
  manga: "openlibrary",
  strategy_guides: "openlibrary",
  movies: "tmdb",
  anime: "tmdb",
};

export function isProviderConfigured(key: ProviderKey): boolean {
  // Open Library is the only keyless provider. musicbrainz and rebrickable have
  // keys reserved in PROVIDER_KEYS but aren't registered in providers/index.ts yet.
  if (key === "igdb") return isIgdbConfigured();
  if (key === "tmdb") return isTmdbConfigured();
  return key === "openlibrary";
}

export type LookupConfig = { key: ProviderKey; label: string };

/**
 * The provider this collection looks up against, or null when there isn't one —
 * unrecognized template, provider not registered, or credentials missing. Callers
 * treat null as "no lookup for this collection" rather than an error, so a
 * missing IGDB key degrades to a hidden panel instead of a broken page.
 */
export function resolveLookupConfig(collection: {
  templateKey: string | null;
  features: CollectionFeatures;
}): LookupConfig | null {
  const explicit = collection.features.lookup
    ? providerKeySchema.safeParse(collection.features.lookup)
    : null;
  if (explicit && !explicit.success) return null;

  const key = explicit?.data ?? (collection.templateKey ? TEMPLATE_DEFAULT_PROVIDER[collection.templateKey] : undefined);
  if (!key || !isProviderConfigured(key)) return null;

  return { key, label: PROVIDER_LABELS[key] };
}
