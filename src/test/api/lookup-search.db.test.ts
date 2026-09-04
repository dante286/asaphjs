import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestUser, type TestUser } from "@/test/db/fixtures";
import { apiRequest, routeContext } from "@/test/db/http";
import { providerServer, interceptProviderNetwork } from "@/test/db/providers";
import { signedInAs, signedInWith, signedOut } from "@/test/db/session";
import { OPENLIBRARY_BASE_URL } from "@/test/providers/handlers";

/**
 * The one route that reads `next/headers` rather than `request.headers`, so
 * this is the one spec that mocks a Next module. The mock is `headers()` alone
 * — the real Better Auth session validation still runs against the cookie it
 * hands over, so "signed out" is the library's answer rather than a stub's.
 */
vi.mock("next/headers", async () => {
  const { sessionHeaders } = await import("@/test/db/session");
  return { headers: async () => sessionHeaders() };
});

/**
 * The same pass-through the providers tier installs, and for the same reason:
 * Open Library's real limiter is one request a second and a hydrate makes up to
 * five, which turned this file into 54 seconds of queueing for no signal about
 * anything it tests. The limiter's own behaviour is covered on fake timers in
 * src/lib/metadata/rate-limiter.test.ts.
 */
vi.mock("@/lib/metadata/rate-limiter", () => ({
  getLimiter: () => ({ schedule: <T>(task: () => Promise<T>) => task() }),
}));

const { GET } = await import("@/app/api/lookup/[provider]/search/route");

interceptProviderNetwork();

let user: TestUser;

beforeEach(async () => {
  user = await createTestUser();
  signedInAs(user);
});

function search(provider: string, q?: string) {
  return GET(
    apiRequest(`/api/lookup/${provider}/search`, q === undefined ? {} : { query: { q } }),
    routeContext({ provider }),
  );
}

/**
 * Every failure this route can answer with is reachable with no credentials at
 * all, which is a property of how `isProviderConfigured` was written: Open
 * Library needs no key, and IGDB and TMDB are unconfigured in this tier
 * exactly as they are on an instance whose owner hasn't set one.
 */
describe("the failure ladder, keyless", () => {
  it("401s a caller with no session", async () => {
    signedOut();

    const response = await search("openlibrary", "frieren");

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Not authorized." });
  });

  it("401s a forged cookie", async () => {
    signedInWith("better-auth.session_token=forged.signature");

    expect((await search("openlibrary", "frieren")).status).toBe(401);
  });

  it("400s a provider that isn't one of ours", async () => {
    const response = await search("wikipedia", "frieren");

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Unknown provider." });
  });

  it.each([undefined, "", " ", "a", " a "])("400s the query %j", async (q) => {
    // Below two characters a provider has nothing to match on and the request
    // is pure quota burn — the same constant the client debounces against.
    const response = await search("openlibrary", q);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "q must be at least 2 characters." });
  });

  it.each(["igdb", "tmdb"])("503s %s, which has no credentials here", async (provider) => {
    const response = await search(provider, "chrono trigger");

    // 503 rather than 500: the instance is missing configuration, which is a
    // different thing from the provider being broken.
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "That provider isn't configured." });
  });

  it.each(["musicbrainz", "rebrickable"])("503s %s, which is reserved but unregistered", async (provider) => {
    // In PROVIDER_KEYS so the schema accepts it, but not in the registry — the
    // route has to answer before `getProvider` throws.
    expect((await search(provider, "chrono trigger")).status).toBe(503);
  });

  it("502s a provider that answers with an error", async () => {
    providerServer.use(
      http.get(`${OPENLIBRARY_BASE_URL}/search.json`, () => new HttpResponse(null, { status: 500 })),
    );

    const response = await search("openlibrary", "frieren");

    // A provider being down or rate-limiting us is not a 500 in this app's
    // terms — the picker shows the message and the owner types values in.
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: "The metadata provider didn't answer. Try again.",
    });
  });

  it("502s a provider that never answers", async () => {
    providerServer.use(http.get(`${OPENLIBRARY_BASE_URL}/search.json`, () => HttpResponse.error()));

    expect((await search("openlibrary", "frieren")).status).toBe(502);
  });
});

describe("a successful search", () => {
  it("answers with the provider's candidates", async () => {
    const response = await search("openlibrary", "frieren");

    expect(response.status).toBe(200);
    const candidates = await response.json();
    expect(candidates[0]).toMatchObject({
      sourceId: "/works/OL21177745W",
      title: "Frieren: Beyond Journey's End, Vol. 1",
      year: 2021,
      subtitle: "Kanehito Yamada, Tsukasa Abe",
    });
    // The fixture's third doc has no title, and the provider drops it before
    // the route ever sees it.
    expect(candidates).toHaveLength(2);
  });

  it("trims the query before passing it on", async () => {
    const response = await search("openlibrary", "  frieren  ");

    expect(response.status).toBe(200);
  });

  it("serves a repeated search from the cache instead of the provider", async () => {
    // The whole point of the cache tables: search-as-you-type must not cost a
    // provider request per keystroke.
    await search("openlibrary", "frieren");

    providerServer.use(
      http.get(`${OPENLIBRARY_BASE_URL}/search.json`, () => {
        throw new Error("the provider was asked twice for one query");
      }),
    );

    const second = await search("openlibrary", "FRIEREN");

    // Normalised, so a different casing is the same query.
    expect(second.status).toBe(200);
    expect(await second.json()).toHaveLength(2);
  });
});
