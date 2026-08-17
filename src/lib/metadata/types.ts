import { z } from "zod";

export const PROVIDER_KEYS = ["igdb", "openlibrary", "tmdb", "musicbrainz", "rebrickable"] as const;
export const providerKeySchema = z.enum(PROVIDER_KEYS);
export type ProviderKey = z.infer<typeof providerKeySchema>;

export const candidateSchema = z.object({
  sourceId: z.string(),
  title: z.string(),
  year: z.number().optional(),
  subtitle: z.string().optional(), // author/console/artist — disambiguates in the picker UI
  coverUrl: z.string().url().optional(),
});
export type Candidate = z.infer<typeof candidateSchema>;

/**
 * hydrate() returns canonical keys — never a provider's own field names — and
 * src/lib/metadata/prefill.ts maps them onto whatever field ids a given
 * collection happens to have (`platforms` -> the "Console" field on Video
 * Games, the "Platform" field on someone's custom variant, nothing at all on
 * Books). Providers fill in the keys they know; the rest stay absent.
 */
export type HydratedFields = {
  title?: string;
  publisher?: string;
  developer?: string;
  author?: string;
  platforms?: string[];
  genre?: string[];
  series?: string;
  releaseDate?: string; // YYYY-MM-DD
  year?: number;
  summary?: string;
  coverUrl?: string;
  sourceUrl?: string;
} & Record<string, unknown>;

export interface MetadataProvider {
  readonly key: ProviderKey;
  search(query: string): Promise<Candidate[]>;
  hydrate(sourceId: string): Promise<HydratedFields>;
}
