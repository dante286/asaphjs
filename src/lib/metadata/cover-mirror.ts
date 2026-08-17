import { MAX_UPLOAD_BYTES } from "@/lib/uploads/limits";
import { saveUpload } from "@/lib/uploads/store";

/**
 * Where a provider's cover art is allowed to come from. The URLs are minted by
 * this app's own provider code, but they round-trip through `metadata_cache` as
 * plain JSON, so the host is checked again before anything is fetched.
 */
const COVER_HOSTS = new Set(["images.igdb.com", "covers.openlibrary.org"]);

const FETCH_TIMEOUT_MS = 15_000;

/**
 * Copies a provider's cover into local storage and returns the app-served URL,
 * or null to keep using the provider's own URL.
 *
 * Worth the round trip because a hotlinked cover is slow in a way that reads as
 * broken: Open Library redirects `covers.openlibrary.org` to archive.org, which
 * extracts the JPEG from a zip on demand — measured at ~8s to first paint, so
 * the item detail page shows an empty cover frame long after the lookup said it
 * filled one, and a 60-tile covers grid pays that per tile. Mirroring also gets
 * these covers the same bounded WebP and thumbnail treatment uploaded photos
 * get, and makes the shelf keep working when a provider takes its art down.
 *
 * Every failure path returns null rather than throwing: a slow or missing image
 * shouldn't cost the caller the metadata it just fetched.
 */
export async function mirrorCover(url: string): Promise<string | null> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || !COVER_HOSTS.has(parsed.hostname)) return null;

  try {
    const res = await fetch(url, {
      // Open Library's cover URLs are two redirects away from the actual bytes.
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { "User-Agent": process.env.METADATA_USER_AGENT ?? "AsaphJS/0.1" },
    });
    if (!res.ok) return null;

    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > MAX_UPLOAD_BYTES) return null;

    const bytes = new Uint8Array(await res.arrayBuffer());
    // Servers that send no content-length still can't hand us an unbounded file.
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_UPLOAD_BYTES) return null;

    return await saveUpload(bytes);
  } catch {
    return null;
  }
}
