import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll } from "vitest";
import sharp from "sharp";
import { handlers } from "@/test/providers/handlers";
import { recordRequestsFrom, resetRecordedRequests } from "@/test/providers/requests";

/**
 * Some of what this tier tests reaches provider code: the items POST route
 * hydrates the candidate the create dialog previewed, and the metadata actions
 * hydrate and then mirror a cover. Those paths make real outbound requests, so
 * the specs that touch them stand MSW up the same way the providers tier does —
 * same handlers, same `onUnhandledRequest: "error"`, so a request nobody
 * claimed fails the test instead of reaching the internet from CI.
 *
 * Open Library is what these specs look up against, because it needs no
 * credentials: the db tier blanks `IGDB_CLIENT_ID` and `TMDB_API_KEY`, so those
 * two providers resolve as unconfigured here, which is a state worth testing on
 * its own rather than working around.
 *
 * Call `interceptProviderNetwork()` at the top level of a spec that needs it —
 * not `use*`, which the React hooks lint rule reads as a hook. The
 * rate limiter is real in this tier — Open Library's is one request a second —
 * but nothing here queues more than a handful, and its interval is unref'd.
 */
const server = setupServer(...handlers);

export { server as providerServer };

/** Where Open Library's cover art comes from, and the one host `mirrorCover` will fetch for it. */
export const OL_COVER_URL = "https://covers.openlibrary.org/b/id/12547191-L.jpg";

/**
 * A real 4x4 PNG, so `saveUpload` has something libvips can actually decode —
 * the mirror path re-encodes to WebP and writes a thumbnail, and a fake body
 * would only ever exercise the failure branch.
 */
async function tinyPng(): Promise<Buffer> {
  return sharp({ create: { width: 4, height: 4, channels: 3, background: "#264653" } })
    .png()
    .toBuffer();
}

let coverBytes: Buffer | null = null;

export function interceptProviderNetwork(): void {
  beforeAll(async () => {
    coverBytes = await tinyPng();
    server.listen({ onUnhandledRequest: "error" });
    /**
     * The same recorder the providers tier installs, on this tier's own server.
     * `onUnhandledRequest: "error"` already proves nothing escapes to the
     * internet; this is for the specs that need to know how many requests went
     * out — which is the only way to see a cache actually sparing a free tier,
     * since a served row and a refetched one both return the same fields.
     */
    recordRequestsFrom(server);
  });

  afterEach(() => {
    server.resetHandlers();
    resetRecordedRequests();
  });

  afterAll(() => {
    server.close();
  });
}

/** Serves the cover `mirrorCover` would fetch, so the mirrored-cover path can be asserted. */
export function coverHandler() {
  return http.get(OL_COVER_URL, () =>
    HttpResponse.arrayBuffer(coverBytes!.buffer.slice(coverBytes!.byteOffset, coverBytes!.byteOffset + coverBytes!.byteLength), {
      headers: { "Content-Type": "image/png" },
    }),
  );
}

/** The other outcome: art the provider names but can't serve, so the caller keeps the provider's URL. */
export function missingCoverHandler() {
  return http.get(OL_COVER_URL, () => new HttpResponse(null, { status: 404 }));
}
