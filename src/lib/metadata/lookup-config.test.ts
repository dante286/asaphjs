import { afterEach, describe, expect, it, vi } from "vitest";
import { PROVIDER_LABELS, isProviderConfigured, resolveLookupConfig } from "./lookup-config";
import type { CollectionFeatures } from "@/types";

// Credentials are stubbed in every test, both directions. Without that, whether
// "video_games resolves to IGDB" passes would depend on the developer's own
// .env — the test would prove nothing on one machine and fail on another.
function withCredentials({ igdb = false, tmdb = false }: { igdb?: boolean; tmdb?: boolean }) {
  vi.stubEnv("IGDB_CLIENT_ID", igdb ? "client-id" : undefined);
  vi.stubEnv("IGDB_CLIENT_SECRET", igdb ? "client-secret" : undefined);
  vi.stubEnv("TMDB_API_KEY", tmdb ? "0".repeat(32) : undefined);
}

const collection = (templateKey: string | null, features: CollectionFeatures = {}) => ({
  templateKey,
  features,
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isProviderConfigured", () => {
  it("treats Open Library as always configured", () => {
    // It's the only keyless provider, which is why the book templates work on
    // a fresh instance with no credentials at all.
    withCredentials({});

    expect(isProviderConfigured("openlibrary")).toBe(true);
  });

  it("needs both halves of the IGDB credential", () => {
    withCredentials({});
    expect(isProviderConfigured("igdb")).toBe(false);

    vi.stubEnv("IGDB_CLIENT_ID", "client-id");
    expect(isProviderConfigured("igdb")).toBe(false);

    vi.stubEnv("IGDB_CLIENT_SECRET", "client-secret");
    expect(isProviderConfigured("igdb")).toBe(true);
  });

  it("accepts any non-empty TMDB credential", () => {
    withCredentials({ tmdb: true });
    expect(isProviderConfigured("tmdb")).toBe(true);

    vi.stubEnv("TMDB_API_KEY", "   ");
    expect(isProviderConfigured("tmdb")).toBe(false);
  });

  it.each(["musicbrainz", "rebrickable"] as const)(
    "reports %s unconfigured — a reserved key with no provider registered",
    (key) => {
      withCredentials({ igdb: true, tmdb: true });

      expect(isProviderConfigured(key)).toBe(false);
    },
  );
});

describe("resolveLookupConfig: template defaults", () => {
  it.each([
    ["books", "openlibrary"],
    ["comics", "openlibrary"],
    ["manga", "openlibrary"],
    ["strategy_guides", "openlibrary"],
  ])("points %s at %s without any credentials", (templateKey, key) => {
    withCredentials({});

    expect(resolveLookupConfig(collection(templateKey))).toEqual({
      key,
      label: PROVIDER_LABELS[key as "openlibrary"],
    });
  });

  it("points video_games at IGDB once it's configured", () => {
    withCredentials({ igdb: true });

    expect(resolveLookupConfig(collection("video_games"))).toEqual({ key: "igdb", label: "IGDB" });
  });

  it.each(["movies", "tv_shows", "anime"])("points %s at TMDB once it's configured", (templateKey) => {
    withCredentials({ tmdb: true });

    expect(resolveLookupConfig(collection(templateKey))).toEqual({ key: "tmdb", label: "TMDB" });
  });

  it("degrades to no lookup when the provider's credentials are missing", () => {
    // Callers read null as "this collection has no lookup", so a missing IGDB
    // key hides the panel instead of producing a page that errors on use.
    withCredentials({});

    expect(resolveLookupConfig(collection("video_games"))).toBeNull();
    expect(resolveLookupConfig(collection("movies"))).toBeNull();
  });

  it.each(["legos", "vinyl", "trading_cards"])("gives %s no lookup at all", (templateKey) => {
    // Better than pointing a Lego collection at a provider that only knows
    // games and returning nonsense candidates.
    withCredentials({ igdb: true, tmdb: true });

    expect(resolveLookupConfig(collection(templateKey))).toBeNull();
  });

  it("gives a blank or CSV-built collection no lookup", () => {
    withCredentials({ igdb: true, tmdb: true });

    expect(resolveLookupConfig(collection(null))).toBeNull();
  });
});

describe("resolveLookupConfig: an explicit features.lookup", () => {
  it("overrides the template default", () => {
    withCredentials({ igdb: true });

    expect(resolveLookupConfig(collection("video_games", { lookup: "openlibrary" }))).toEqual({
      key: "openlibrary",
      label: "Open Library",
    });
  });

  it("returns null for an unrecognised provider rather than falling back", () => {
    // The fallback would silently look a collection up against a provider its
    // owner didn't ask for, so a typo turns the feature off instead.
    withCredentials({ igdb: true });

    expect(resolveLookupConfig(collection("video_games", { lookup: "goodreads" }))).toBeNull();
  });

  it("returns null for a known-but-unregistered provider", () => {
    withCredentials({ igdb: true });

    expect(resolveLookupConfig(collection("video_games", { lookup: "musicbrainz" }))).toBeNull();
  });

  it("falls back to the template default when lookup is empty", () => {
    // An empty string is falsy, so it's read as "not set" rather than as an
    // unrecognised provider.
    withCredentials({ igdb: true });

    expect(resolveLookupConfig(collection("video_games", { lookup: "" }))).toEqual({
      key: "igdb",
      label: "IGDB",
    });
  });
});

describe("PROVIDER_LABELS", () => {
  it("gives every provider key a display label", () => {
    expect(Object.values(PROVIDER_LABELS).every((label) => label.length > 0)).toBe(true);
  });
});
