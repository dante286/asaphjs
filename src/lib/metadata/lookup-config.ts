import { providerKeySchema, type ProviderKey } from "./types";
import { isIgdbConfigured } from "./providers/igdb";
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
 * Movies at a provider that only knows games.
 */
const TEMPLATE_DEFAULT_PROVIDER: Record<string, ProviderKey> = {
  video_games: "igdb",
  books: "openlibrary",
  comics: "openlibrary",
  manga: "openlibrary",
  strategy_guides: "openlibrary",
};

export function isProviderConfigured(key: ProviderKey): boolean {
  // Only IGDB needs credentials so far; the rest are either keyless or not
  // registered in providers/index.ts yet.
  if (key === "igdb") return isIgdbConfigured();
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
