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

// hydrate() returns provider-shaped data; the per-template prefill map
// (still open — see CLAUDE-PLAN.md) decides which keys land in which field id.
export type HydratedFields = Record<string, unknown> & { coverUrl?: string };

export interface MetadataProvider {
  readonly key: ProviderKey;
  search(query: string): Promise<Candidate[]>;
  hydrate(sourceId: string): Promise<HydratedFields>;
}
