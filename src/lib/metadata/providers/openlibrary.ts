import { getLimiter } from "../rate-limiter";
import type { Candidate, HydratedFields, MetadataProvider } from "../types";

const UA = process.env.METADATA_USER_AGENT ?? "AsaphJS/0.1 (set METADATA_USER_AGENT)";
const limiter = getLimiter("openlibrary", 1, 1000); // no published ceiling — be polite anyway
const BASE = "https://openlibrary.org";

// Without an explicit field list, search.json returns every indexed field for
// every doc — hundreds of KB for ten results, nearly all of it unused.
const SEARCH_FIELDS = "key,title,author_name,first_publish_year,cover_i,publisher,subject";

type OpenLibraryDoc = {
  key: string;
  title?: string;
  first_publish_year?: number;
  author_name?: string[];
  cover_i?: number;
  publisher?: string[];
  subject?: string[];
};

type OpenLibraryWork = {
  title?: string;
  subjects?: string[];
  covers?: number[];
  description?: string | { value?: string };
  authors?: Array<{ author?: { key?: string } }>;
  series?: Array<{ series?: { key?: string } } | string>;
};

async function getJson<T>(path: string): Promise<T | null> {
  return limiter.schedule(async () => {
    const res = await fetch(`${BASE}${path}`, { headers: { "User-Agent": UA } });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`OpenLibrary ${path} failed: ${res.status}`);
    return res.json() as Promise<T>;
  });
}

function coverUrlFor(id: number | undefined): string | undefined {
  return id && id > 0 ? `https://covers.openlibrary.org/b/id/${id}-L.jpg` : undefined;
}

/** Up to two names joined — manga list story and art separately, and both belong in an Author field. */
function joinAuthors(names: string[] | undefined): string | undefined {
  const cleaned = (names ?? []).map((n) => n.trim()).filter(Boolean);
  return cleaned.length > 0 ? cleaned.slice(0, 2).join(", ") : undefined;
}

/**
 * `publisher` is every edition's publisher in one unordered list — Eragon has 56
 * of them across a dozen languages, and picking the first would fill the field
 * with a Dutch imprint. Only an unambiguous list is worth writing.
 */
function singlePublisher(publishers: string[] | undefined): string | undefined {
  const distinct = new Map<string, string>();
  for (const p of publishers ?? []) {
    const name = p.trim();
    if (name) distinct.set(name.toLowerCase(), name);
  }
  return distinct.size === 1 ? [...distinct.values()][0] : undefined;
}

/**
 * Open Library subjects mix real ones with machine tags ("nyt:graphic-books-and-manga=2021-04-11",
 * "form:manga", "franchise:葬送のフリーレン") and long catalogue phrases. Keep the ones a
 * person would recognize as a genre.
 */
function cleanSubjects(subjects: string[] | undefined): string[] {
  const seen = new Map<string, string>();
  for (const raw of subjects ?? []) {
    const subject = raw.trim();
    if (!subject || subject.length > 40) continue;
    if (subject.includes(":") || subject.includes("=")) continue;
    seen.set(subject.toLowerCase(), subject);
    if (seen.size >= 3) break;
  }
  return [...seen.values()];
}

function descriptionText(description: OpenLibraryWork["description"]): string | undefined {
  const text = typeof description === "string" ? description : description?.value;
  return text?.trim() || undefined;
}

/** Works reference their series by key ("/series/OL326107L"), so the name is one more fetch. */
async function seriesName(work: OpenLibraryWork): Promise<string | undefined> {
  const entry = work.series?.[0];
  if (typeof entry === "string") return entry.trim() || undefined;

  const key = entry?.series?.key;
  if (!key) return undefined;

  const series = await getJson<{ name?: string }>(`${key}.json`);
  return series?.name?.trim() || undefined;
}

/** Fallback for when the search index has no doc for this work — author records hold the names. */
async function authorNamesFromWork(work: OpenLibraryWork): Promise<string[]> {
  const keys = (work.authors ?? []).map((a) => a.author?.key).filter((k): k is string => Boolean(k));
  const records = await Promise.all(keys.slice(0, 2).map((key) => getJson<{ name?: string }>(`${key}.json`)));
  return records.map((r) => r?.name).filter((n): n is string => Boolean(n));
}

export const openLibraryProvider: MetadataProvider = {
  key: "openlibrary",

  async search(query): Promise<Candidate[]> {
    const data = await getJson<{ docs?: OpenLibraryDoc[] }>(
      `/search.json?q=${encodeURIComponent(query)}&fields=${SEARCH_FIELDS}&limit=10`,
    );

    return (data?.docs ?? [])
      .filter((d) => d.title)
      .map((d) => ({
        sourceId: d.key, // e.g. "/works/OL45804W"
        title: d.title!,
        year: d.first_publish_year,
        subtitle: joinAuthors(d.author_name),
        coverUrl: coverUrlFor(d.cover_i),
      }));
  },

  /**
   * A work record alone can't fill a Books collection: it names its authors and
   * series by key rather than value, and its `covers` array can be empty (or hold
   * a -1 placeholder) for a work the search index does have art for — which is why
   * a lookup could show a cover in the picker and then apply none. So this reads
   * the work *and* its search-index doc, and resolves the remaining keys.
   */
  async hydrate(sourceId): Promise<HydratedFields> {
    if (!sourceId.startsWith("/works/")) throw new Error(`Invalid Open Library work key: ${sourceId}`);

    const [work, search] = await Promise.all([
      getJson<OpenLibraryWork>(`${sourceId}.json`),
      getJson<{ docs?: OpenLibraryDoc[] }>(
        `/search.json?q=key:${encodeURIComponent(sourceId)}&fields=${SEARCH_FIELDS}&limit=1`,
      ),
    ]);
    if (!work) throw new Error(`Open Library work ${sourceId} not found`);

    const doc = search?.docs?.[0];
    const [series, fallbackAuthors] = await Promise.all([
      seriesName(work),
      doc?.author_name?.length ? Promise.resolve([]) : authorNamesFromWork(work),
    ]);

    return {
      title: work.title ?? doc?.title,
      author: joinAuthors(doc?.author_name ?? fallbackAuthors),
      publisher: singlePublisher(doc?.publisher),
      genre: cleanSubjects(work.subjects ?? doc?.subject),
      series,
      year: doc?.first_publish_year,
      summary: descriptionText(work.description),
      coverUrl: coverUrlFor(work.covers?.find((id) => id > 0) ?? doc?.cover_i),
      sourceUrl: `${BASE}${sourceId}`,
    };
  },
};
