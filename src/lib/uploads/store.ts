import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import sharp from "sharp";

/**
 * The detail page renders the cover in a ~330px frame and the covers grid in
 * less, so this is already generous at 2x — it exists to stop a 4000px phone
 * photo being served whole, not to be a display size.
 */
export const MAX_DIMENSION = 1600;
const WEBP_QUALITY = 82;

/**
 * Uploads are served through a route handler, not out of `public/`: Next scans
 * the public folder once at server start in production, so a file written after
 * boot would 404 until the next restart. Reading it per request also keeps the
 * bytes off the build image and inside the mounted volume.
 */
const URL_PREFIX = "/api/uploads/";

/**
 * nanoid's alphabet is `A-Za-z0-9_-`, so a matching name can't contain a path
 * separator. `saveUpload` only ever writes `.webp` now; the other extensions
 * stay readable so files written before that keep resolving.
 */
const NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}\.(jpg|png|webp|gif|avif)$/;

const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
};

export function uploadsDir(): string {
  return process.env.UPLOADS_DIR ?? path.join(process.cwd(), "uploads");
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

/**
 * Container sniffing rather than trusting the browser's Content-Type — the
 * extension chosen here is what the read route later hands back as the
 * response's Content-Type, so it has to come from the bytes themselves.
 */
export function sniffImageExt(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (ascii(bytes, 0, 8) === "\x89PNG\r\n\x1a\n") return "png";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "webp";
  const gif = ascii(bytes, 0, 6);
  if (gif === "GIF87a" || gif === "GIF89a") return "gif";
  if (ascii(bytes, 4, 4) === "ftyp" && ["avif", "avis"].includes(ascii(bytes, 8, 4))) return "avif";
  return null;
}

/**
 * Re-encodes the upload to a bounded WebP and returns the URL to store on the
 * item, or null if the bytes aren't a decodable image.
 *
 * Everything is re-encoded rather than stored as-sent, which buys three things
 * at once: phone photos stop being served at full resolution, EXIF is dropped
 * (a camera roll photo carries GPS coordinates), and the bytes on disk are
 * output libvips produced rather than a stranger's file. Orientation has to be
 * applied via `.rotate()` before that EXIF goes, or portrait shots come out
 * sideways. Animated GIFs keep their first frame only — these are covers.
 */
export async function saveUpload(bytes: Uint8Array): Promise<string | null> {
  // Cheap structural reject so obvious non-images never reach the decoder.
  if (!sniffImageExt(bytes)) return null;

  let encoded: Buffer;
  try {
    encoded = await sharp(bytes, { failOn: "error" })
      .rotate()
      .resize({
        width: MAX_DIMENSION,
        height: MAX_DIMENSION,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer();
  } catch {
    return null;
  }

  const dir = uploadsDir();
  await mkdir(dir, { recursive: true });
  const name = `${nanoid()}.webp`;
  await writeFile(path.join(dir, name), encoded);
  return `${URL_PREFIX}${name}`;
}

/** True only for URLs this store minted — provider cover URLs must never be unlinked. */
export function isManagedUpload(url: string | null | undefined): url is string {
  return Boolean(url?.startsWith(URL_PREFIX) && NAME_PATTERN.test(url.slice(URL_PREFIX.length)));
}

export async function deleteUpload(url: string | null | undefined): Promise<void> {
  if (!isManagedUpload(url)) return;
  await unlink(path.join(uploadsDir(), url.slice(URL_PREFIX.length))).catch(() => {});
}

export async function readUpload(
  name: string,
): Promise<{ bytes: Uint8Array<ArrayBuffer>; mime: string } | null> {
  if (!NAME_PATTERN.test(name)) return null;
  try {
    const bytes = await readFile(path.join(uploadsDir(), name));
    return { bytes: new Uint8Array(bytes), mime: MIME_BY_EXT[name.slice(name.lastIndexOf(".") + 1)] };
  } catch {
    return null;
  }
}
