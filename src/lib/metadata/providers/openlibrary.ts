import { getLimiter } from "../rate-limiter";
import type { Candidate, HydratedFields, MetadataProvider } from "../types";

const UA = process.env.METADATA_USER_AGENT ?? "AsaphJS/0.1 (set METADATA_USER_AGENT)";
const limiter = getLimiter("openlibrary", 1, 1000); // no published ceiling — be polite anyway

export const openLibraryProvider: MetadataProvider = {
  key: "openlibrary",
  async search(query): Promise<Candidate[]> {
    return limiter.schedule(async () => {
      const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=10`;
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (!res.ok) throw new Error(`OpenLibrary search failed: ${res.status}`);
      const data = await res.json();
      return (data.docs ?? []).map((d: any) => ({
        sourceId: d.key, // e.g. "/works/OL45804W"
        title: d.title,
        year: d.first_publish_year,
        subtitle: d.author_name?.[0],
        coverUrl: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg` : undefined,
      }));
    });
  },
  async hydrate(sourceId): Promise<HydratedFields> {
    return limiter.schedule(async () => {
      const res = await fetch(`https://openlibrary.org${sourceId}.json`, { headers: { "User-Agent": UA } });
      if (!res.ok) throw new Error(`OpenLibrary hydrate failed: ${res.status}`);
      const w = await res.json();
      const coverId = w.covers?.[0];
      return {
        title: w.title,
        genre: w.subjects?.slice(0, 3),
        coverUrl: coverId ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg` : undefined,
        // Author name needs a second fetch (works reference authors by key,
        // not name) — add when this one gets tested for real.
      };
    });
  },
};
