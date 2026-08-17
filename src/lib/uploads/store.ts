import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import sharp from "sharp";
import {
  NAME_PATTERN,
  UPLOAD_URL_PREFIX,
  fullNameForThumb,
  isManagedUpload,
  isThumbName,
  thumbNameFor,
} from "@/lib/uploads/urls";

/**
 * The detail page renders the cover in a ~330px frame, so this is already
 * generous at 2x — it exists to stop a 4000px phone photo being served whole,
 * not to be a display size.
 */
export const MAX_DIMENSION = 1600;

/**
 * The covers grid caps a tile at 182px wide on a 3/4 frame, so 500 on the
 * longest edge covers the common portrait cover at 2x (375px wide) without
 * baking in a crop. Landscape photos upscale slightly when `object-fit: cover`
 * fills the frame; that beats shipping the 1600px file to every tile.
 */
export const THUMB_DIMENSION = 500;

const WEBP_QUALITY = 82;

/**
 * Uploads are served through a route handler, not out of `public/`: Next scans
 * the public folder once at server start in production, so a file written after
 * boot would 404 until the next restart. Reading it per request also keeps the
 * bytes off the build image and inside the mounted volume.
 */

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
 * Re-encodes the upload to a bounded WebP plus a grid-sized thumbnail, and
 * returns the URL of the full-size one to store on the item. Null if the bytes
 * aren't a decodable image.
 *
 * Everything is re-encoded rather than stored as-sent, which buys three things
 * at once: phone photos stop being served at full resolution, EXIF is dropped
 * (a camera roll photo carries GPS coordinates), and the bytes on disk are
 * output libvips produced rather than a stranger's file. Orientation has to be
 * applied via `.rotate()` before that EXIF goes, or portrait shots come out
 * sideways. Animated GIFs keep their first frame only — these are covers.
 *
 * Only the full-size URL is stored; the thumb is found by name, so no schema
 * change and provider covers keep working unchanged.
 */
export async function saveUpload(bytes: Uint8Array): Promise<string | null> {
  // Cheap structural reject so obvious non-images never reach the decoder.
  if (!sniffImageExt(bytes)) return null;

  let full: Buffer;
  let thumb: Buffer;
  try {
    full = await sharp(bytes, { failOn: "error" })
      .rotate()
      .resize({
        width: MAX_DIMENSION,
        height: MAX_DIMENSION,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer();

    // Derived from the bounded copy rather than the original: one less decode
    // of a possibly-huge source, and orientation is already baked in.
    thumb = await sharp(full)
      .resize({
        width: THUMB_DIMENSION,
        height: THUMB_DIMENSION,
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

  try {
    await Promise.all([
      writeFile(path.join(dir, name), full),
      writeFile(path.join(dir, thumbNameFor(name)), thumb),
    ]);
  } catch {
    // Don't leave half a pair behind for a URL we're about to not return.
    await removeFile(dir, name);
    await removeFile(dir, thumbNameFor(name));
    return null;
  }

  return `${UPLOAD_URL_PREFIX}${name}`;
}

function removeFile(dir: string, name: string): Promise<void> {
  return unlink(path.join(dir, name)).catch(() => {});
}

/** Removes the full-size file and its thumbnail together. */
export async function deleteUpload(url: string | null | undefined): Promise<void> {
  if (!isManagedUpload(url)) return;
  const dir = uploadsDir();
  const name = url.slice(UPLOAD_URL_PREFIX.length);
  await Promise.all([removeFile(dir, name), removeFile(dir, thumbNameFor(name))]);
}

export async function readUpload(
  name: string,
): Promise<{ bytes: Uint8Array<ArrayBuffer>; mime: string } | null> {
  if (!NAME_PATTERN.test(name)) return null;

  const dir = uploadsDir();
  let bytes: Buffer;
  try {
    bytes = await readFile(path.join(dir, name));
  } catch {
    // Uploads written before thumbnails existed have no `_t` file. Serving the
    // full-size image beats a broken tile, and it self-corrects on re-upload.
    if (!isThumbName(name)) return null;
    try {
      bytes = await readFile(path.join(dir, fullNameForThumb(name)));
    } catch {
      return null;
    }
  }

  return { bytes: new Uint8Array(bytes), mime: MIME_BY_EXT[name.slice(name.lastIndexOf(".") + 1)] };
}
