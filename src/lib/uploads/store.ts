import { mkdir, writeFile } from "node:fs/promises";
import { nanoid } from "nanoid";
import sharp from "sharp";
import { UPLOAD_URL_PREFIX, thumbNameFor } from "@/lib/uploads/urls";
import { removeUploadFile, uploadPath, uploadsDir } from "@/lib/uploads/files";

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
      writeFile(/*turbopackIgnore: true*/ uploadPath(name), full),
      writeFile(/*turbopackIgnore: true*/ uploadPath(thumbNameFor(name)), thumb),
    ]);
  } catch {
    // Don't leave half a pair behind for a URL we're about to not return.
    await Promise.all([removeUploadFile(name), removeUploadFile(thumbNameFor(name))]);
    return null;
  }

  return `${UPLOAD_URL_PREFIX}${name}`;
}
