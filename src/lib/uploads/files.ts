import { readFile, unlink } from "node:fs/promises";
import path from "node:path";
import {
  NAME_PATTERN,
  UPLOAD_URL_PREFIX,
  fullNameForThumb,
  isManagedUpload,
  isThumbName,
  thumbNameFor,
} from "@/lib/uploads/urls";

/**
 * Reading and removing stored uploads — everything that touches the files but
 * doesn't encode them. Split from `store.ts` because that module imports sharp:
 * cleanup belongs in the query layer, and routing every caller of `deleteItem`
 * through sharp would pull libvips into their standalone traces (see
 * `outputFileTracingIncludes` in next.config.ts) for the sake of an `unlink`.
 *
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

/** Best-effort by design: a missing file is the state we wanted anyway. */
export function removeUploadFile(name: string): Promise<void> {
  return unlink(path.join(uploadsDir(), name)).catch(() => {});
}

/** Removes the full-size file and its thumbnail together. */
export async function deleteUpload(url: string | null | undefined): Promise<void> {
  if (!isManagedUpload(url)) return;
  const name = url.slice(UPLOAD_URL_PREFIX.length);
  await Promise.all([removeUploadFile(name), removeUploadFile(thumbNameFor(name))]);
}

/**
 * Bulk form for deletes that take rows with them — an item, a collection's worth
 * of items, a rolled-back import batch. Anything that isn't a URL this store
 * minted (a provider cover, a null) is skipped, and duplicates are collapsed so
 * the same file isn't unlinked twice. Returns how many covers were removed.
 */
export async function deleteUploads(urls: Array<string | null | undefined>): Promise<number> {
  const managed = new Set(urls.filter(isManagedUpload));
  await Promise.all([...managed].map(deleteUpload));
  return managed.size;
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
