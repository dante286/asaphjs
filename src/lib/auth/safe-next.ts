/**
 * Where a successful sign-in is allowed to land.
 *
 * `middleware.ts` puts the path you were aiming for into `?next=`, `/auth`
 * hands it to the form as a hidden input, and `signInAction` redirects there.
 * Every step of that carries an attacker-supplied string: a link to
 * `/auth?next=https://elsewhere.example/login` is a link to *this* instance, so
 * it survives the reader's usual check of the domain before they type a
 * password. Without this, the redirect after a genuinely successful sign-in
 * hands them straight to whoever sent the link, at the moment they have most
 * reason to trust the page.
 *
 * Resolved against a placeholder origin rather than pattern-matched, because
 * the interesting inputs are the ones that don't look absolute. `//host` is
 * protocol-relative, and browsers normalise the backslash in `/\host` to a
 * slash before resolving it — so both reach an external origin while passing
 * any "starts with a single /" test written by hand. The URL parser already
 * knows all of this; comparing the origin it produces is the whole check.
 *
 * The placeholder is `.invalid`, which is reserved by RFC 2606 and therefore
 * cannot resolve to anything real if a bug ever let one escape.
 */
const PLACEHOLDER_ORIGIN = "http://placeholder.invalid";

export function safeNext(next: string): string {
  if (!next.startsWith("/")) return "/";

  let resolved: URL;
  try {
    resolved = new URL(next, PLACEHOLDER_ORIGIN);
  } catch {
    return "/";
  }

  if (resolved.origin !== PLACEHOLDER_ORIGIN) return "/";

  // Rebuilt from the parsed parts rather than returned as given, so what
  // reaches `redirect()` is the same string the check was performed on.
  return `${resolved.pathname}${resolved.search}${resolved.hash}`;
}
