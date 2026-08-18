import { getLimiter } from "../rate-limiter";
import type { Candidate, HydratedFields, MetadataProvider } from "../types";

const BASE = "https://api.themoviedb.org/3";
const IMAGE_BASE = "https://image.tmdb.org/t/p/w500";
// TMDB's soft ceiling is ~40-50 req/s per key — nowhere near a concern for
// interactive lookup, but a limiter keeps a future backfill job well clear of it.
const limiter = getLimiter("tmdb", 20, 1000);

export function isTmdbConfigured(): boolean {
  return Boolean(process.env.TMDB_API_KEY);
}

type TmdbMediaType = "movie" | "tv";

type TmdbSearchResult = {
  id: number;
  media_type?: TmdbMediaType | "person";
  title?: string; // movie
  name?: string; // tv
  release_date?: string; // movie
  first_air_date?: string; // tv
  poster_path?: string | null;
};

type TmdbDetail = {
  title?: string;
  name?: string;
  overview?: string;
  release_date?: string;
  first_air_date?: string;
  poster_path?: string | null;
  genres?: Array<{ name?: string }>;
  belongs_to_collection?: { name?: string } | null; // movie franchise — TV has no equivalent
};

async function getJson<T>(path: string): Promise<T | null> {
  if (!isTmdbConfigured()) throw new Error("TMDB is not configured — set TMDB_API_KEY.");

  return limiter.schedule(async () => {
    const res = await fetch(`${BASE}${path}`, {
      headers: { Authorization: `Bearer ${process.env.TMDB_API_KEY}`, Accept: "application/json" },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`TMDB ${path} failed: ${res.status}`);
    return res.json() as Promise<T>;
  });
}

function posterUrl(path: string | null | undefined): string | undefined {
  return path ? `${IMAGE_BASE}${path}` : undefined;
}

/** Movies carry `title`, TV carries `name` — the same field under two names. */
function titleOf(r: { title?: string; name?: string }): string | undefined {
  return r.title ?? r.name;
}

function yearOf(r: { release_date?: string; first_air_date?: string }): number | undefined {
  // TMDB sends "" rather than omitting the key for an unscheduled release.
  const date = r.release_date || r.first_air_date;
  return date ? Number(date.slice(0, 4)) || undefined : undefined;
}

/** "movie:603" / "tv:1396" — hydrate() needs to know which endpoint to hit. */
function encodeSourceId(mediaType: TmdbMediaType, id: number): string {
  return `${mediaType}:${id}`;
}

function decodeSourceId(sourceId: string): { mediaType: TmdbMediaType; id: number } {
  const [mediaType, idStr] = sourceId.split(":");
  const id = Number(idStr);
  if ((mediaType !== "movie" && mediaType !== "tv") || !Number.isInteger(id)) {
    throw new Error(`Invalid TMDB source id: ${sourceId}`);
  }
  return { mediaType, id };
}

function releaseDateOf(detail: TmdbDetail): string | undefined {
  const date = detail.release_date || detail.first_air_date;
  return /^\d{4}-\d{2}-\d{2}$/.test(date ?? "") ? date : undefined;
}

export const tmdbProvider: MetadataProvider = {
  key: "tmdb",

  /**
   * `search/multi` rather than the per-type endpoints: the Anime template holds
   * both films and series, so one query has to reach both. Person hits come back
   * on the same endpoint and are dropped.
   */
  async search(query): Promise<Candidate[]> {
    const term = query.trim();
    if (!term) return [];

    const data = await getJson<{ results?: TmdbSearchResult[] }>(
      `/search/multi?query=${encodeURIComponent(term)}&include_adult=false`,
    );

    return (data?.results ?? [])
      .filter((r): r is TmdbSearchResult & { media_type: TmdbMediaType } =>
        (r.media_type === "movie" || r.media_type === "tv") && Boolean(titleOf(r)),
      )
      .slice(0, 10)
      .map((r) => ({
        sourceId: encodeSourceId(r.media_type, r.id),
        title: titleOf(r)!,
        year: yearOf(r),
        subtitle: r.media_type === "tv" ? "TV" : undefined, // disambiguates a movie/show title collision in the picker
        coverUrl: posterUrl(r.poster_path),
      }));
  },

  async hydrate(sourceId): Promise<HydratedFields> {
    const { mediaType, id } = decodeSourceId(sourceId);
    const detail = await getJson<TmdbDetail>(`/${mediaType}/${id}`);
    if (!detail) throw new Error(`TMDB ${mediaType} ${id} not found`);

    return {
      title: titleOf(detail),
      genre: (detail.genres ?? []).map((g) => g.name).filter((n): n is string => Boolean(n)),
      // Movies group into franchises via belongs_to_collection; TV has no
      // equivalent concept, so a show's Series field is left for the owner.
      series: detail.belongs_to_collection?.name,
      releaseDate: releaseDateOf(detail),
      year: yearOf(detail),
      summary: detail.overview?.trim() || undefined,
      coverUrl: posterUrl(detail.poster_path),
      sourceUrl: `https://www.themoviedb.org/${mediaType}/${id}`,
    };
  },
};
