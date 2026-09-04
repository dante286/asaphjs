/**
 * Calling a route handler is calling a function: the exported GET/POST/PATCH/
 * DELETE take a `Request` and a `{ params }` object, and `requireRole` reads
 * the session off `request.headers`. So these two helpers are the whole test
 * harness for `src/app/api/**` — no Next request scope, no HTTP server.
 *
 * The origin is a placeholder. Handlers only ever read the path and the query
 * string off `request.url`, never the host.
 */
const ORIGIN = "http://asaph.test";

export type RequestOptions = {
  /** A `TestUser`'s `cookie`. Omitted means an anonymous caller. */
  cookie?: string;
  /** `?token=...` is how the share link presents itself to a route. */
  token?: string;
  query?: Record<string, string>;
  method?: string;
  /** Serialised as JSON unless it's already a `FormData` or a string. */
  body?: unknown;
  headers?: Record<string, string>;
};

export function apiRequest(path: string, options: RequestOptions = {}): Request {
  const url = new URL(path, ORIGIN);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    url.searchParams.set(key, value);
  }
  if (options.token) url.searchParams.set("token", options.token);

  const headers = new Headers(options.headers);
  if (options.cookie) headers.set("cookie", options.cookie);

  let body: BodyInit | undefined;
  if (options.body instanceof FormData || typeof options.body === "string") {
    body = options.body;
  } else if (options.body !== undefined) {
    body = JSON.stringify(options.body);
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
  }

  return new Request(url, { method: options.method ?? (body ? "POST" : "GET"), headers, body });
}

/**
 * The second argument every handler in this app takes. Params arrive as a
 * promise in the App Router, so they are handed over as one here rather than
 * awaited early — that's the shape the handler destructures.
 */
export function routeContext<T extends Record<string, string>>(params: T): { params: Promise<T> } {
  return { params: Promise.resolve(params) };
}
