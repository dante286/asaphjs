import type { SetupServer } from "msw/node";

export type RecordedRequest = {
  method: string;
  url: URL;
  headers: Headers;
  /** Empty string for a GET — IGDB is the only provider that sends a body. */
  body: string;
};

/**
 * Every request MSW saw, in order. Some of what these specs assert isn't
 * visible in a return value at all: that a token is fetched once and reused,
 * that a missing credential throws *before* any call goes out, that the
 * author-record fallback is skipped when the search index already had the
 * names. Counting requests is the only way to see those.
 *
 * Recorded from a life-cycle event rather than inside the handlers, so a
 * request some spec's own `server.use` override answers is recorded too.
 */
const pending: Array<Promise<RecordedRequest>> = [];

export function recordRequestsFrom(server: SetupServer): void {
  server.events.on("request:start", (event) => {
    const { request } = event;
    // The handler still has to read this body, so take a copy — reading the
    // original here would leave the handler an already-consumed stream.
    const copy = request.clone();
    pending.push(
      copy.text().then((body) => ({
        method: request.method,
        url: new URL(request.url),
        headers: request.headers,
        body,
      })),
    );
  });
}

export function resetRecordedRequests(): void {
  pending.length = 0;
}

/** Async because the bodies are read off a clone of each request. */
export function recordedRequests(): Promise<RecordedRequest[]> {
  return Promise.all(pending);
}

/** The subset sent to one host — `requestsTo("api.igdb.com")`. */
export async function requestsTo(hostname: string): Promise<RecordedRequest[]> {
  return (await recordedRequests()).filter((r) => r.url.hostname === hostname);
}
