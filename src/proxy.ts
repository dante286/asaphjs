import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";
import { contentSecurityPolicy, cspHeaderName, HSTS_VALUE, servedOverHttps } from "@/lib/security-headers";

/**
 * Runs before every page (see `config.matcher`), for two jobs.
 *
 * 1. The sign-in redirect for the signed-in-only pages: an optimistic
 *    cookie-presence check, cheap and with no DB round trip. Real authorization
 *    (and role checks) still happen server-side per request.
 * 2. The per-request security headers from `src/lib/security-headers.ts`: a
 *    Content-Security-Policy carrying a fresh script nonce, and HSTS on https
 *    instances. Next reads the nonce back out of the request's CSP header while
 *    rendering, and tags its own scripts with it.
 *
 * Was `middleware.ts`; Next 16 renamed the convention to `proxy`.
 */

/** Paths that bounce to /auth without a session cookie: what `middleware.ts`'s matcher used to list. */
const SIGNED_IN_ONLY = [/^\/$/, /^\/collections(\/|$)/, /^\/account(\/|$)/];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (SIGNED_IN_ONLY.some((pattern) => pattern.test(pathname)) && !getSessionCookie(request)) {
    const url = new URL("/auth", request.url);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const https = servedOverHttps();
  const csp = contentSecurityPolicy({ nonce, dev: process.env.NODE_ENV === "development", https });
  const header = cspHeaderName();

  // On the request too, which is where Next looks for the nonce. Overwriting it
  // also discards any CSP header a client sent, so nobody can choose the nonce.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete("content-security-policy");
  requestHeaders.delete("content-security-policy-report-only");
  requestHeaders.set("content-security-policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(header, csp);
  if (https) response.headers.set("Strict-Transport-Security", HSTS_VALUE);
  return response;
}

export const config = {
  matcher: [
    {
      // Pages only. API routes answer JSON or files, and set their own headers
      // where it matters (`/api/uploads/*` sends a sandboxing CSP of its own).
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      // Prefetches are RSC payloads, not documents: no CSP to apply.
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
