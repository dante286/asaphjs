import { getLimiter } from "../rate-limiter";
import type { Candidate, HydratedFields, MetadataProvider } from "../types";

const TWITCH_TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const IGDB_BASE = "https://api.igdb.com/v4";
const limiter = getLimiter("igdb", 4, 1000); // IGDB's documented ceiling

let cachedToken: { value: string; expiresAt: number } | null = null;

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

async function igdbQuery(endpoint: string, body: string) {
  return limiter.schedule(async () => {
    const token = await getAppAccessToken();
    const res = await fetch(`${IGDB_BASE}/${endpoint}`, {
      method: "POST",
      headers: { "Client-ID": process.env.IGDB_CLIENT_ID!, Authorization: `Bearer ${token}` },
      body,
    });
    if (!res.ok) throw new Error(`IGDB ${endpoint} failed: ${res.status}`);
    return res.json() as Promise<any[]>;
  });
}

export const igdbProvider: MetadataProvider = {
  key: "igdb",
  async search(query): Promise<Candidate[]> {
    const rows = await igdbQuery(
      "games",
      `search "${query.replace(/"/g, "")}"; fields name,first_release_date,cover.url; limit 10;`,
    );
    return rows.map((g) => ({
      sourceId: String(g.id),
      title: g.name,
      year: g.first_release_date ? new Date(g.first_release_date * 1000).getFullYear() : undefined,
      coverUrl: g.cover?.url ? `https:${g.cover.url.replace("t_thumb", "t_cover_big")}` : undefined,
    }));
  },
  async hydrate(sourceId): Promise<HydratedFields> {
    const id = Number(sourceId);
    if (!Number.isInteger(id)) throw new Error(`Invalid IGDB id: ${sourceId}`);

    const [g] = await igdbQuery(
      "games",
      `where id = ${id}; fields name,involved_companies.company.name,platforms.name,cover.url; limit 1;`,
    );
    if (!g) throw new Error(`IGDB game ${sourceId} not found`);

    return {
      title: g.name,
      publisher: g.involved_companies?.[0]?.company?.name,
      console: g.platforms?.[0]?.name,
      coverUrl: g.cover?.url ? `https:${g.cover.url.replace("t_thumb", "t_cover_big")}` : undefined,
    };
  },
};
