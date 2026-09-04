import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/collections/[id]/items/route";
import { updateCollectionSettings } from "@/db/queries/collections";
import { createItem, listItems } from "@/db/queries/items";
import { acceptInvite, inviteMember } from "@/db/queries/members";
import { aCollection, createTestUser, testFields, type TestUser } from "@/test/db/fixtures";
import { apiRequest, routeContext } from "@/test/db/http";
import { OL_COVER_URL, coverHandler, missingCoverHandler, providerServer, interceptProviderNetwork } from "@/test/db/providers";
import { OL_WORK_KEY } from "@/test/providers/fixtures";

/**
 * GET and POST on a collection's items. The parts worth a test are the ones a
 * type can't state: that a public caller gets the stripped projection rather
 * than the rows, and that the cover and provenance on a created item are
 * re-read server-side rather than taken from the body — a forged POST must not
 * be able to point an item's cover at an arbitrary URL.
 */

/**
 * The same pass-through the providers tier installs, and for the same reason:
 * Open Library's real limiter is one request a second and a hydrate makes up to
 * five, which turned this file into 54 seconds of queueing for no signal about
 * anything it tests. The limiter's own behaviour is covered on fake timers in
 * src/lib/metadata/rate-limiter.test.ts.
 */
vi.mock("@/lib/metadata/rate-limiter", () => ({
  getLimiter: () => ({ schedule: <T>(task: () => Promise<T>) => task() }),
}));

interceptProviderNetwork();

const SHARE_TOKEN = "tok_items_spec";

let owner: TestUser;
let collectionId: string;

beforeEach(async () => {
  owner = await createTestUser();
  const collection = await aCollection({ ownerId: owner.id });
  collectionId = collection.id;
  await updateCollectionSettings(collectionId, { shareToken: SHARE_TOKEN, shareEnabled: true });
});

/** The owner unless a test says otherwise — most of these are about what a route does, not who called it. */
function get(options: Parameters<typeof apiRequest>[1] = {}) {
  return GET(
    apiRequest(`/api/collections/${collectionId}/items`, { cookie: owner.cookie, ...options }),
    routeContext({ id: collectionId }),
  );
}

function post(body: unknown, options: Parameters<typeof apiRequest>[1] = {}) {
  return POST(
    apiRequest(`/api/collections/${collectionId}/items`, {
      method: "POST",
      body,
      cookie: owner.cookie,
      ...options,
    }),
    routeContext({ id: collectionId }),
  );
}

describe("GET", () => {
  it("answers the owner with the page and its total", async () => {
    await createItem({ collectionId, title: "Chrono Trigger" });

    const response = await get({ cookie: owner.cookie });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ total: 1, page: 1, pageSize: 60 });
  });

  it("passes the query string through as filters", async () => {
    await createItem({ collectionId, title: "Chrono Trigger", verified: true });
    await createItem({ collectionId, title: "Earthbound", borrower: "Alex" });

    const filtered = await get({ cookie: owner.cookie, query: { q: "chrono", verifiedOnly: "1" } });
    const lent = await get({ cookie: owner.cookie, query: { lentOnly: "1" } });

    expect((await filtered.json()).rows.map((r: { title: string }) => r.title)).toEqual(["Chrono Trigger"]);
    expect((await lent.json()).rows.map((r: { title: string }) => r.title)).toEqual(["Earthbound"]);
  });

  it("reads the page number off the query string", async () => {
    await createItem({ collectionId, title: "Chrono Trigger" });

    const response = await get({ cookie: owner.cookie, query: { page: "2" } });

    expect(await response.json()).toMatchObject({ page: 2, rows: [] });
  });

  it("strips a public caller's rows", async () => {
    // The same rule the `/s/:token` page applies, enforced here so a leak in
    // one path can't happen without the other catching it too.
    await createItem({
      collectionId,
      title: "Chrono Trigger",
      borrower: "Alex",
      notes: "Second copy, keep the boxed one.",
      values: { console: "SNES", paid: 220 },
    });

    const response = await get({ cookie: undefined, token: SHARE_TOKEN });

    const [row] = (await response.json()).rows;
    expect(row).toMatchObject({ title: "Chrono Trigger", borrower: null, notes: null });
    // `paid` is the private field on the test collection; `console` isn't.
    expect(row.values).toEqual({ console: "SNES" });
  });

  it("gives a signed-in viewer the unstripped rows", async () => {
    const viewer = await createTestUser();
    const invite = await inviteMember({
      collectionId,
      invitedEmail: viewer.email,
      role: "viewer",
      invitedBy: owner.id,
    });
    await acceptInvite(invite.inviteToken!, viewer.id, viewer.email);
    await createItem({ collectionId, title: "Chrono Trigger", borrower: "Alex", values: { paid: 220 } });

    const [row] = (await (await get({ cookie: viewer.cookie })).json()).rows;

    // A viewer was invited by name; the public projection is for strangers with
    // a link, not for people who were given access.
    expect(row).toMatchObject({ borrower: "Alex", values: { paid: 220 } });
  });

  it("refuses a caller with no access", async () => {
    const stranger = await createTestUser();

    expect((await get({ cookie: stranger.cookie })).status).toBe(403);
    expect((await get({ cookie: undefined })).status).toBe(403);
  });
});

describe("POST", () => {
  it("creates the whole item the dialog collected", async () => {
    const response = await post({
      title: "  Chrono Trigger  ",
      values: { console: "SNES", paid: 220 },
      verified: true,
      borrower: "Alex",
      notes: "Second copy",
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      // Trimmed by the schema, not by the client.
      title: "Chrono Trigger",
      values: { console: "SNES", paid: 220 },
      verified: true,
      borrower: "Alex",
      notes: "Second copy",
      coverUrl: null,
      externalRef: null,
    });
  });

  it("lets an editor create, and refuses a viewer and a share link", async () => {
    const editor = await createTestUser();
    const invite = await inviteMember({
      collectionId,
      invitedEmail: editor.email,
      role: "editor",
      invitedBy: owner.id,
    });
    await acceptInvite(invite.inviteToken!, editor.id, editor.email);

    expect((await post({ title: "By the editor" }, { cookie: editor.cookie })).status).toBe(201);
    expect((await post({ title: "By a link" }, { cookie: undefined, token: SHARE_TOKEN })).status).toBe(403);
  });

  it("names the missing title in its error", async () => {
    // The dialog surfaces this message directly, and "Title is required" is
    // actionable where "couldn't be saved" isn't.
    const response = await post({ title: "   " });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Title is required." });
  });

  it("rejects a body that isn't shaped like an item", async () => {
    const response = await post({ title: "Chrono Trigger", verified: "yes" });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "That item couldn't be saved as sent." });
  });

  it("rejects a body that isn't JSON at all", async () => {
    const response = await POST(
      apiRequest(`/api/collections/${collectionId}/items`, {
        method: "POST",
        body: "not json",
        headers: { "content-type": "application/json" },
        cookie: owner.cookie,
      }),
      routeContext({ id: collectionId }),
    );

    expect(response.status).toBe(400);
  });

  it("ignores a cover and a provenance stamp sent by the client", async () => {
    // Only `match.sourceId` is taken from the body. Both of these are fields
    // the server owns, and a forged POST claiming them would point an item's
    // cover at an arbitrary URL and fake a provider match.
    const response = await post({
      title: "Chrono Trigger",
      coverUrl: "https://evil.example/cover.jpg",
      externalRef: { source: "igdb", id: "1017", fetchedAt: "2026-01-01T00:00:00.000Z" },
    });

    // Stripped by the schema rather than refused: `newItemSchema` lists what a
    // client may send, and zod drops what isn't on the list. The item is
    // created, with the server's own answer for both fields.
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      title: "Chrono Trigger",
      coverUrl: null,
      externalRef: null,
    });
    const { rows } = await listItems({ collectionId });
    expect(rows[0]).toMatchObject({ coverUrl: null, externalRef: null });
  });

  describe("with a provider match", () => {
    beforeEach(async () => {
      await updateCollectionSettings(collectionId, { features: { lookup: "openlibrary" } });
    });

    it("mirrors the matched cover and stamps the provenance itself", async () => {
      providerServer.use(coverHandler());

      const response = await post({ title: "Frieren", match: { sourceId: OL_WORK_KEY } });

      const item = await response.json();
      // Served by this app, not hotlinked to the provider — a mirrored cover is
      // a local WebP under /api/uploads.
      expect(item.coverUrl).toMatch(/^\/api\/uploads\/[A-Za-z0-9_-]{21}\.webp$/);
      expect(item.externalRef).toMatchObject({ source: "openlibrary", id: OL_WORK_KEY });
      expect(item.externalRef.fetchedAt).toEqual(expect.any(String));
    });

    it("falls back to the provider's URL when the art can't be fetched", async () => {
      providerServer.use(missingCoverHandler());

      const item = await (await post({ title: "Frieren", match: { sourceId: OL_WORK_KEY } })).json();

      // Still renders, still matched — mirroring is an improvement on
      // hotlinking, not a precondition for saving.
      expect(item.coverUrl).toBe(OL_COVER_URL);
      expect(item.externalRef).toMatchObject({ source: "openlibrary" });
    });

    it("keeps the draft when the provider fails outright", async () => {
      providerServer.use(
        (await import("msw")).http.get("https://openlibrary.org/works/:work", () => new Response(null, { status: 500 })),
      );

      const response = await post({
        title: "Frieren",
        values: { console: "SNES" },
        match: { sourceId: OL_WORK_KEY },
      });

      // The values the owner reviewed in the dialog are in the body already, so
      // a provider that has gone away costs the cover and the link — not the item.
      expect(response.status).toBe(201);
      expect(await response.json()).toMatchObject({
        title: "Frieren",
        values: { console: "SNES" },
        coverUrl: null,
        externalRef: null,
      });
    });

    it("saves a match whose record has no cover art at all", async () => {
      const { http, HttpResponse } = await import("msw");
      providerServer.use(
        http.get("https://openlibrary.org/works/:work", () =>
          HttpResponse.json({ title: "Frieren", covers: [], subjects: [] }),
        ),
        // The search index has to be empty too: hydrate falls back to the doc's
        // `cover_i` precisely so a work record with no art can still show one.
        http.get("https://openlibrary.org/search.json", () => HttpResponse.json({ docs: [] })),
      );

      const item = await (await post({ title: "Frieren", match: { sourceId: OL_WORK_KEY } })).json();

      // Nothing to mirror and nothing to hotlink, but still a match: the
      // provenance is what "Re-run lookup" reads back later.
      expect(item.coverUrl).toBeNull();
      expect(item.externalRef).toMatchObject({ source: "openlibrary", id: OL_WORK_KEY });
    });

    it("refuses a match when the collection has no provider", async () => {
      await updateCollectionSettings(collectionId, { features: {} });

      const response = await post({ title: "Frieren", match: { sourceId: OL_WORK_KEY } });

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "This collection has no metadata provider configured.",
      });
    });

    it("refuses a match when the collection's provider has no credentials", async () => {
      // IGDB and TMDB are unconfigured in this tier, which is the same state an
      // instance is in before its owner sets a key — the lookup UI is hidden
      // and this path has to refuse rather than half-work.
      await updateCollectionSettings(collectionId, { features: { lookup: "igdb" } });

      expect((await post({ title: "Chrono Trigger", match: { sourceId: "1017" } })).status).toBe(400);
    });
  });
});

describe("the collection's own fields", () => {
  it("uses them to decide what a public caller may see", async () => {
    // The stripping is driven by the field defs on the row, so a field turned
    // private after items were written takes effect on the next read.
    await createItem({ collectionId, title: "Chrono Trigger", values: { console: "SNES", paid: 220 } });
    const fields = testFields().map((f) => (f.id === "console" ? { ...f, private: true } : f));
    const { updateCollectionFields } = await import("@/db/queries/collections");
    await updateCollectionFields(collectionId, fields);

    const [row] = (await (await get({ cookie: undefined, token: SHARE_TOKEN })).json()).rows;

    expect(row.values).toEqual({});
  });
});
