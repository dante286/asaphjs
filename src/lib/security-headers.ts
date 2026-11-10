/**
 * Response headers that tell the browser what this app will and won't do.
 *
 * Two kinds, applied in two places:
 *
 * - The static ones (`STATIC_SECURITY_HEADERS`, `TOKEN_PAGE_HEADERS`) never
 *   depend on the deployment, so `next.config.ts` sets them on every response,
 *   API routes and assets included.
 * - The Content-Security-Policy and HSTS are per request: the CSP carries a
 *   fresh script nonce each time, and both depend on whether the instance is
 *   served over https. That has to be read at runtime, because one image runs
 *   behind any origin. `proxy.ts` sets them on pages.
 *
 * Behind a reverse proxy that terminates TLS, the request this server sees is
 * plain http whatever the browser used, so "is this https?" comes from the
 * operator's `BETTER_AUTH_URL`, never from the request.
 */

/** Cover art hosts the app renders directly: un-mirrored covers and lookup previews. */
const IMAGE_HOSTS = [
  "https://images.igdb.com",
  "https://image.tmdb.org",
  "https://covers.openlibrary.org",
  // Open Library's covers redirect to archive.org, which redirects again to a
  // storage node (`ia800….us.archive.org`). A wildcard doesn't match the bare
  // domain, so both are listed; every hop has to be allowed.
  "https://archive.org",
  "https://*.archive.org",
];

/** The design system's typefaces (`src/app/design-system.css`). */
const FONT_STYLESHEET_HOST = "https://fonts.googleapis.com";
const FONT_FILE_HOST = "https://fonts.gstatic.com";

/** Whether `BETTER_AUTH_URL` says this instance is served over https. Read per call. */
export function servedOverHttps(): boolean {
  try {
    return new URL(process.env.BETTER_AUTH_URL?.trim() ?? "").protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * The policy for one page response.
 *
 * - Scripts: only Next's own, which it tags with this request's nonce, plus
 *   whatever those load (`'strict-dynamic'`). An injected `<script>` has no
 *   nonce and doesn't run. Development adds `'unsafe-eval'`, which React's dev
 *   build needs and production doesn't.
 * - Styles allow `'unsafe-inline'`: React `style={{…}}` props are style
 *   attributes, which a nonce can't cover, and they're used throughout. Note
 *   that adding a nonce here would make browsers *ignore* `'unsafe-inline'`.
 *   Style injection is far less dangerous than script injection, and scripts
 *   are what the nonce protects.
 * - `frame-ancestors 'none'`: no page may be framed, so no clickjacking.
 * - `upgrade-insecure-requests` only when served over https; on plain-http
 *   local or LAN installs it would break every subresource.
 */
export function contentSecurityPolicy(options: { nonce: string; dev: boolean; https: boolean }): string {
  const { nonce, dev, https } = options;
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'unsafe-inline' ${FONT_STYLESHEET_HOST}`,
    `img-src 'self' data: blob: ${IMAGE_HOSTS.join(" ")}`,
    `font-src 'self' ${FONT_FILE_HOST}`,
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(https ? ["upgrade-insecure-requests"] : []),
  ];
  return directives.join("; ");
}

/**
 * `CSP_REPORT_ONLY=true` sends the policy as `Content-Security-Policy-Report-Only`,
 * so violations show in the browser console without blocking anything. That's
 * the escape hatch for a reverse proxy or CDN that injects scripts of its own
 * (Cloudflare's Rocket Loader or email obfuscation, say) until the operator
 * turns that feature off. Only the literal `true` switches it.
 */
export function cspHeaderName(): string {
  return process.env.CSP_REPORT_ONLY?.trim().toLowerCase() === "true"
    ? "Content-Security-Policy-Report-Only"
    : "Content-Security-Policy";
}

/**
 * HSTS for an https instance. A year, without `includeSubDomains` (other hosts
 * under the operator's domain aren't this app's to decide) and without
 * `preload`, which is a commitment only the operator should make. If the
 * reverse proxy already sends one, browsers honor the first and ignore the rest.
 */
export const HSTS_VALUE = "max-age=31536000";

/** For every response. Static, so `next.config.ts` can set them at build time. */
export const STATIC_SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  // For browsers too old for `frame-ancestors`; the CSP says the same.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

/**
 * Pages whose URL *is* a credential: a share token, an invite token, a reset
 * token. No Referer at all from them, not even the origin, so a link or image
 * on one can't carry the address anywhere.
 */
export const TOKEN_PAGE_SOURCES = ["/s/:path*", "/invite/:path*", "/join/:path*", "/auth/reset"];

export const TOKEN_PAGE_HEADERS = [{ key: "Referrer-Policy", value: "no-referrer" }];
