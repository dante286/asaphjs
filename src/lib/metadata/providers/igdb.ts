import { getLimiter } from "../rate-limiter";
import type { Candidate, HydratedFields, MetadataProvider } from "../types";

const TWITCH_TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const IGDB_BASE = "https://api.igdb.com/v4";
const limiter = getLimiter("igdb", 4, 1000); // IGDB's documented ceiling

// game_type: 0 main game, 8 remake, 9 remaster, 10 expanded, 11 port. Everything
// else IGDB indexes (mods, DLC, bundles, the Satellaview "Music Library" oddities)
// is not a thing anyone owns a boxed copy of, and unfiltered `search` puts those
// above the release you actually own — searching "chrono trigger" without this
// ranks three Satellaview add-ons above the 1995 SNES cartridge.
const SHELF_GAME_TYPES = "(0,8,9,10,11)";

const SEARCH_FIELDS = "name,first_release_date,cover.url,platforms.name,platforms.abbreviation";
const HYDRATE_FIELDS = [
  "name",
  "summary",
  "first_release_date",
  "involved_companies.company.name",
  "involved_companies.publisher",
  "involved_companies.developer",
  "platforms.name",
  "platforms.abbreviation",
  "genres.name",
  "franchises.name",
  "collections.name",
  "cover.url",
  "url",
].join(",");

let cachedToken: { value: string; expiresAt: number } | null = null;

export function isIgdbConfigured(): boolean {
  return Boolean(process.env.IGDB_CLIENT_ID && process.env.IGDB_CLIENT_SECRET);
}

async function getAppAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;

  const params = new URLSearchParams({
    client_id: process.env.IGDB_CLIENT_ID!,
    client_secret: process.env.IGDB_CLIENT_SECRET!,
    grant_type: "client_credentials",
  });
  const res = await fetch(`${TWITCH_TOKEN_URL}?${params}`, { method: "POST" });
  if (!res.ok) throw new Error(`Twitch token request failed: ${res.status}`);

  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cachedToken.value;
}

type IgdbGame = {
  id: number;
  name?: string;
  summary?: string;
  url?: string;
  first_release_date?: number;
  cover?: { url?: string };
  platforms?: Array<{ name?: string; abbreviation?: string }>;
  genres?: Array<{ name?: string }>;
  franchises?: Array<{ name?: string }>;
  collections?: Array<{ name?: string }>;
  involved_companies?: Array<{ company?: { name?: string }; publisher?: boolean; developer?: boolean }>;
};

async function igdbQuery(endpoint: string, body: string): Promise<IgdbGame[]> {
  if (!isIgdbConfigured()) throw new Error("IGDB is not configured — set IGDB_CLIENT_ID and IGDB_CLIENT_SECRET.");

  return limiter.schedule(async () => {
    const token = await getAppAccessToken();
    const res = await fetch(`${IGDB_BASE}/${endpoint}`, {
      method: "POST",
      headers: { "Client-ID": process.env.IGDB_CLIENT_ID!, Authorization: `Bearer ${token}` },
      body,
    });
    if (!res.ok) throw new Error(`IGDB ${endpoint} failed: ${res.status}`);
    return res.json() as Promise<IgdbGame[]>;
  });
}

// APICalypse takes the search term as a quoted string terminated by `;` — a
// quote or semicolon in a title would end the clause and change the query.
function quoteSearchTerm(query: string): string {
  return query.replace(/["\\;\r\n]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
}

function coverUrlOf(game: IgdbGame): string | undefined {
  // t_thumb is what IGDB returns regardless of what you ask for; the size lives
  // in the path, so swapping the segment is the documented way to size up.
  return game.cover?.url ? `https:${game.cover.url.replace("t_thumb", "t_cover_big")}` : undefined;
}

/** Abbreviation ("SNES") over full name ("Super Nintendo Entertainment System") — what a collector writes on a shelf label. */
function platformsOf(game: IgdbGame): string[] {
  return (game.platforms ?? []).map((p) => p.abbreviation ?? p.name).filter((p): p is string => Boolean(p));
}

function yearOf(game: IgdbGame): number | undefined {
  return game.first_release_date ? new Date(game.first_release_date * 1000).getUTCFullYear() : undefined;
}

export const igdbProvider: MetadataProvider = {
  key: "igdb",
  async search(query): Promise<Candidate[]> {
    const term = quoteSearchTerm(query);
    if (!term) return [];

    const rows = await igdbQuery(
      "games",
      `search "${term}"; fields ${SEARCH_FIELDS}; where game_type = ${SHELF_GAME_TYPES}; limit 10;`,
    );

    return rows
      .filter((g) => g.name)
      .map((g) => ({
        sourceId: String(g.id),
        title: g.name!,
        year: yearOf(g),
        // The same game exists once per release — platform is what tells the
        // SNES cartridge apart from the 2018 PC port in the picker.
        subtitle: platformsOf(g).slice(0, 4).join(" · ") || undefined,
        coverUrl: coverUrlOf(g),
      }));
  },

  async hydrate(sourceId): Promise<HydratedFields> {
    const id = Number(sourceId);
    if (!Number.isInteger(id)) throw new Error(`Invalid IGDB id: ${sourceId}`);

    const [game] = await igdbQuery("games", `where id = ${id}; fields ${HYDRATE_FIELDS}; limit 1;`);
    if (!game) throw new Error(`IGDB game ${sourceId} not found`);

    const companies = game.involved_companies ?? [];
    const publisher = (companies.find((c) => c.publisher) ?? companies[0])?.company?.name;
    const developer = (companies.find((c) => c.developer) ?? companies[0])?.company?.name;
    const platforms = platformsOf(game);
    const releaseDate = game.first_release_date
      ? new Date(game.first_release_date * 1000).toISOString().slice(0, 10)
      : undefined;

    // Canonical keys — src/lib/metadata/prefill.ts maps these onto whatever
    // field ids the collection actually has.
    return {
      title: game.name,
      publisher,
      developer,
      platforms,
      genre: (game.genres ?? []).map((g) => g.name).filter((n): n is string => Boolean(n)),
      series: game.franchises?.[0]?.name ?? game.collections?.[0]?.name,
      releaseDate,
      year: yearOf(game),
      summary: game.summary,
      coverUrl: coverUrlOf(game),
      sourceUrl: game.url,
    };
  },
};
