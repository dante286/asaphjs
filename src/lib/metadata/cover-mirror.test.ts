import { describe, expect, it } from "vitest";
import { isMirrorableCoverUrl } from "./cover-mirror";

// These URLs are minted by this app's own provider code, but they round-trip
// through metadata_cache as plain JSON, so by the time mirrorCover sees one it
// is untrusted input again. This is the check that makes it safe to fetch.

describe("isMirrorableCoverUrl", () => {
  it.each([
    "https://images.igdb.com/igdb/image/upload/t_cover_big/co2i5f.jpg",
    "https://covers.openlibrary.org/b/id/8231856-L.jpg",
    "https://image.tmdb.org/t/p/w500/abc.jpg",
  ])("accepts %s", (url) => {
    expect(isMirrorableCoverUrl(url)).toBe(true);
  });

  it("requires https", () => {
    // The fetch follows redirects, so plain http would be a downgrade the
    // caller can't see.
    expect(isMirrorableCoverUrl("http://images.igdb.com/igdb/image/upload/co2i5f.jpg")).toBe(false);
  });

  it("compares the host exactly, not as a suffix", () => {
    // The check is a Set lookup on `hostname` rather than a string match on
    // the URL, which is what makes these fail.
    expect(isMirrorableCoverUrl("https://images.igdb.com.evil.example/co2i5f.jpg")).toBe(false);
    expect(isMirrorableCoverUrl("https://evil.example/images.igdb.com/co2i5f.jpg")).toBe(false);
    expect(isMirrorableCoverUrl("https://notimages.igdb.com/co2i5f.jpg")).toBe(false);
  });

  it("isn't fooled by credentials in the authority", () => {
    expect(isMirrorableCoverUrl("https://images.igdb.com@evil.example/co2i5f.jpg")).toBe(false);
  });

  it("normalises host case, since the URL parser lowercases it", () => {
    expect(isMirrorableCoverUrl("https://IMAGES.IGDB.COM/igdb/image/upload/co2i5f.jpg")).toBe(true);
  });

  it("rejects a host no provider owns", () => {
    // A provider missing from the host set fails silently and the item keeps
    // the provider's own URL, so adding a provider means adding its host.
    expect(isMirrorableCoverUrl("https://cdn.example.com/cover.jpg")).toBe(false);
  });

  it.each([
    ["a local path", "/api/uploads/abc.webp"],
    ["a relative path", "covers/abc.jpg"],
    ["a data URL", "data:image/png;base64,iVBORw0KGgo="],
    ["a file URL", "file:///etc/passwd"],
    ["empty", ""],
    ["nonsense", "not a url at all"],
  ])("rejects %s without throwing", (_label, url) => {
    expect(isMirrorableCoverUrl(url)).toBe(false);
  });

  it("rejects a non-http scheme even on an allowed host", () => {
    expect(isMirrorableCoverUrl("ftp://images.igdb.com/co2i5f.jpg")).toBe(false);
  });
});
