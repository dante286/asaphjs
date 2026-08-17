/**
 * Naming rules for stored uploads. Shared by the store, the read route and the
 * covers grid, so it stays free of node imports — `store.ts` is server-only.
 */

export const UPLOAD_URL_PREFIX = "/api/uploads/";

/**
 * `_` is in nanoid's alphabet, so a thumb name still matches NAME_PATTERN and
 * needs no loosening of the traversal guard. Ids are a fixed 21 characters and
 * a thumb name is 23, so `<id>_t` can never collide with another item's `<id>`.
 */
export const THUMB_SUFFIX = "_t";

/** nanoid's alphabet is `A-Za-z0-9_-`, so a matching name can't contain a path separator. */
export const NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}\.(jpg|png|webp|gif|avif)$/;

/** True only for URLs this store minted — provider cover URLs must never be unlinked. */
export function isManagedUpload(url: string | null | undefined): url is string {
  return Boolean(
    url?.startsWith(UPLOAD_URL_PREFIX) && NAME_PATTERN.test(url.slice(UPLOAD_URL_PREFIX.length)),
  );
}

function splitExt(name: string): [stem: string, ext: string] {
  const dot = name.lastIndexOf(".");
  return [name.slice(0, dot), name.slice(dot)];
}

export function isThumbName(name: string): boolean {
  return splitExt(name)[0].endsWith(THUMB_SUFFIX);
}

/** `<id>_t.webp` -> `<id>.webp`. Only meaningful for names that are thumbs. */
export function fullNameForThumb(name: string): string {
  const [stem, ext] = splitExt(name);
  return `${stem.slice(0, -THUMB_SUFFIX.length)}${ext}`;
}

export function thumbNameFor(name: string): string {
  const [stem, ext] = splitExt(name);
  return `${stem}${THUMB_SUFFIX}${ext}`;
}

/**
 * The grid-sized variant of a cover. Provider URLs (and anything else we didn't
 * write) come back untouched, since there's no derivative to point at.
 */
export function thumbUrlFor(url: string | null | undefined): string | null {
  if (!url) return null;
  if (!isManagedUpload(url)) return url;

  const name = url.slice(UPLOAD_URL_PREFIX.length);
  if (isThumbName(name)) return url;
  return `${UPLOAD_URL_PREFIX}${thumbNameFor(name)}`;
}
