import { headers } from "next/headers";

/**
 * The origin this request actually arrived on, for links that have to be
 * absolute because someone is going to paste them somewhere else.
 *
 * Read from the request rather than from `NEXT_PUBLIC_BETTER_AUTH_URL`: that one
 * is inlined into the client bundle at build time (see the Dockerfile), so an
 * image built for one host and served from another would hand out share links
 * pointing at the wrong place. And rather than `window.location.origin`, which
 * is only knowable on the client — a component that branches on `typeof window`
 * renders one thing on the server and another after hydration, which is exactly
 * the mismatch this replaced.
 *
 * `x-forwarded-*` come first for the reverse-proxy case; the scheme falls back
 * to http only for loopback, since anything else reachable by name should be
 * https and a wrong guess here ends up in someone's clipboard.
 */
export async function requestOrigin(): Promise<string> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const isLoopback = /^(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(host);
  const proto = requestHeaders.get("x-forwarded-proto") ?? (isLoopback ? "http" : "https");

  return `${proto}://${host}`;
}
