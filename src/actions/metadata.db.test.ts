import { readdir } from "node:fs/promises";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { updateCollectionSettings } from "@/db/queries/collections";
import { createItem, getItem, patchItem } from "@/db/queries/items";
import { acceptInvite, inviteMember } from "@/db/queries/members";
import { aCollection, createTestUser, type TestUser } from "@/test/db/fixtures";
import { coverHandler, missingCoverHandler, providerServer, interceptProviderNetwork, OL_COVER_URL } from "@/test/db/providers";
import { signedInAs, signedOut } from "@/test/db/session";
import { UPLOADS_DIR } from "@/test/db/setup";
import { OPENLIBRARY_BASE_URL } from "@/test/providers/handlers";
import { OL_WORK_KEY } from "@/test/providers/fixtures";
import type { FieldDef } from "@/lib/fields/field-def";

/**
 * Applying a lookup is the one action that writes to two places at once — a
 * row and a file — so the assertion that matters is what happens when the
 * second half fails: a mirrored cover has to be deleted again if the patch it
 * was fetched for doesn't land, or the bytes sit in the uploads volume forever
 * with nothing pointing at them.
 *
 * Open Library is the provider throughout because it needs no credentials, and
 * MSW answers for it.
 */
vi.mock("next/headers", async () => {
  const { sessionHeaders } = await import("@/test/db/session");
  return { headers: async () => sessionHeaders() };
});

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

const actions = await import("./metadata");

interceptProviderNetwork();

// A Books-shaped collection, so the hydrated fields have somewhere to land.
const FIELDS: FieldDef[] = [
  { id: "title", label: "Title", type: "text", order: 0, origin: "template" },
  { id: "author", label: "Author", type: "text", order: 1, origin: "template" },
  { id: "publisher", label: "Publisher", type: "text", order: 2, origin: "template" },
  { id: "genre", label: "Genre", type: "tags", order: 3, origin: "template" },
  { id: "series", label: "Series", type: "text", order: 4, origin: "template" },
  { id: "summary", label: "Synopsis", type: "longtext", order: 5, origin: "template" },
];

let owner: TestUser;
let collectionId: string;
let itemId: string;

beforeEach(async () => {
  owner = await createTestUser();
  signedInAs(owner);
  const collection = await aCollection({ ownerId: owner.id, name: "Books", fields: FIELDS });
  collectionId = collection.id;
  await updateCollectionSettings(collectionId, { features: { lookup: "openlibrary" } });
  const item = await createItem({ collectionId, title: "Frieren" });
  itemId = item.id;
});

describe("applyLookupAction", () => {
  it("fills the blanks the provider has data for", async () => {
    providerServer.use(coverHandler());

    const result = await actions.applyLookupAction({ collectionId, itemId, sourceId: OL_WORK_KEY });

    expect(result.item).toMatchObject({
      // The owner typed "Frieren" and it stays: a blank-only apply doesn't
      // rename an item to the provider's longer edition title.
      title: "Frieren",
      values: {
        author: "Kanehito Yamada, Tsukasa Abe",
        publisher: "VIZ Media LLC",
        series: "Frieren: Beyond Journey's End",
      },
    });
    // Field labels, not ids — both lists are shown to the owner.
    expect(result.applied).toContain("Author");
    expect(result.keptExisting).toContain("Title");
  });

  it("mirrors the cover rather than hotlinking it", async () => {
    providerServer.use(coverHandler());

    const result = await actions.applyLookupAction({ collectionId, itemId, sourceId: OL_WORK_KEY });

    // A hotlinked Open Library cover is two redirects and ~8s from the bytes,
    // which reads as "the cover didn't apply".
    expect(result.item.coverUrl).toMatch(/^\/api\/uploads\/[A-Za-z0-9_-]{21}\.webp$/);
    expect(await readdir(UPLOADS_DIR)).toHaveLength(2);
  });

  it("keeps the provider's URL when the art can't be fetched", async () => {
    providerServer.use(missingCoverHandler());

    const result = await actions.applyLookupAction({ collectionId, itemId, sourceId: OL_WORK_KEY });

    expect(result.item.coverUrl).toBe(OL_COVER_URL);
    expect(await readdir(UPLOADS_DIR)).toEqual([]);
  });

  it("stamps the provenance the detail page reads back", async () => {
    providerServer.use(missingCoverHandler());

    await actions.applyLookupAction({ collectionId, itemId, sourceId: OL_WORK_KEY });

    expect((await getItem(itemId))?.externalRef).toMatchObject({
      source: "openlibrary",
      id: OL_WORK_KEY,
    });
  });

  it("leaves an owner's own value alone unless told to overwrite", async () => {
    providerServer.use(missingCoverHandler());
    await patchItem(itemId, { values: { author: "Someone I typed" } });

    const result = await actions.applyLookupAction({ collectionId, itemId, sourceId: OL_WORK_KEY });

    expect(result.item.values).toMatchObject({ author: "Someone I typed" });
    expect(result.keptExisting).toContain("Author");
    expect(result.applied).not.toContain("Author");
  });

  it("overwrites when asked", async () => {
    providerServer.use(missingCoverHandler());
    await patchItem(itemId, { values: { author: "Someone I typed" } });

    const result = await actions.applyLookupAction({
      collectionId,
      itemId,
      sourceId: OL_WORK_KEY,
      overwrite: true,
    });

    expect(result.item.values).toMatchObject({ author: "Kanehito Yamada, Tsukasa Abe" });
    expect(result.applied).toContain("Author");
  });

  describe("when the patch fails after the cover is mirrored", () => {
    it("deletes the mirrored bytes and says the row moved", async () => {
      providerServer.use(coverHandler());
      const item = await getItem(itemId);
      const stale = new Date(item!.updatedAt.getTime() - 1000).toISOString();

      await expect(
        actions.applyLookupAction({
          collectionId,
          itemId,
          sourceId: OL_WORK_KEY,
          ifMatchUpdatedAt: stale,
        }),
      ).rejects.toThrow("This item changed elsewhere — reload and try again.");

      // The compensating delete. Without it every conflicted apply leaves a
      // WebP pair in the volume that nothing will ever reference or sweep.
      expect(await readdir(UPLOADS_DIR)).toEqual([]);
      expect(await getItem(itemId)).toMatchObject({ coverUrl: null, externalRef: null });
    });

    it("leaves the cover the item already had", async () => {
      providerServer.use(coverHandler());
      // First apply lands a mirrored cover.
      const first = await actions.applyLookupAction({ collectionId, itemId, sourceId: OL_WORK_KEY });
      const stale = new Date(new Date(first.item.updatedAt).getTime() - 1000).toISOString();

      await expect(
        actions.applyLookupAction({
          collectionId,
          itemId,
          sourceId: OL_WORK_KEY,
          overwrite: true,
          ifMatchUpdatedAt: stale,
        }),
      ).rejects.toThrow(/changed elsewhere/);

      // The second mirror is gone; the first is still the item's cover.
      expect(await readdir(UPLOADS_DIR)).toHaveLength(2);
      expect((await getItem(itemId))?.coverUrl).toBe(first.item.coverUrl);
    });
  });

  it("replaces the cover it superseded on a successful overwrite", async () => {
    providerServer.use(coverHandler());
    const first = await actions.applyLookupAction({ collectionId, itemId, sourceId: OL_WORK_KEY });

    const second = await actions.applyLookupAction({
      collectionId,
      itemId,
      sourceId: OL_WORK_KEY,
      overwrite: true,
    });

    // One pair on disk, not two — the old mirror goes with the row that named it.
    expect(second.item.coverUrl).not.toBe(first.item.coverUrl);
    expect(await readdir(UPLOADS_DIR)).toHaveLength(2);
  });

  it("refuses a viewer", async () => {
    const viewer = await createTestUser();
    const invite = await inviteMember({
      collectionId,
      invitedEmail: viewer.email,
      role: "viewer",
      invitedBy: owner.id,
    });
    await acceptInvite(invite.inviteToken!, viewer.id, viewer.email);
    signedInAs(viewer);

    await expect(
      actions.applyLookupAction({ collectionId, itemId, sourceId: OL_WORK_KEY }),
    ).rejects.toThrow("Not authorized.");
  });

  it("refuses a caller with no session", async () => {
    signedOut();

    await expect(
      actions.applyLookupAction({ collectionId, itemId, sourceId: OL_WORK_KEY }),
    ).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") });
  });

  it("refuses an item from another collection", async () => {
    const other = await createTestUser();
    const theirs = await aCollection({ ownerId: other.id, name: "Theirs" });
    const theirItem = await createItem({ collectionId: theirs.id, title: "Theirs" });

    // Every one of these re-checks that the item really belongs to the
    // collection whose role was checked.
    await expect(
      actions.applyLookupAction({ collectionId, itemId: theirItem.id, sourceId: OL_WORK_KEY }),
    ).rejects.toThrow("Item not found.");
  });

  it("refuses a collection with no provider configured", async () => {
    await updateCollectionSettings(collectionId, { features: {} });

    await expect(
      actions.applyLookupAction({ collectionId, itemId, sourceId: OL_WORK_KEY }),
    ).rejects.toThrow("This collection has no metadata provider configured.");
  });

  it("surfaces a provider failure rather than half-applying", async () => {
    providerServer.use(
      http.get(`${OPENLIBRARY_BASE_URL}/works/:work`, () => new HttpResponse(null, { status: 500 })),
    );

    await expect(
      actions.applyLookupAction({ collectionId, itemId, sourceId: OL_WORK_KEY }),
    ).rejects.toThrow();
    expect(await getItem(itemId)).toMatchObject({ title: "Frieren", externalRef: null });
  });
});

describe("rerunLookupAction", () => {
  it("refetches past the cache and overwrites", async () => {
    providerServer.use(missingCoverHandler());
    await actions.applyLookupAction({ collectionId, itemId, sourceId: OL_WORK_KEY });
    await patchItem(itemId, { values: { author: "Edited since" } });

    const result = await actions.rerunLookupAction({ collectionId, itemId });

    // The escape hatch for a match applied before the provider had good data:
    // overwrite is implied.
    expect(result.item.values).toMatchObject({ author: "Kanehito Yamada, Tsukasa Abe" });
  });

  it("asks the provider again rather than reading the row it cached", async () => {
    providerServer.use(missingCoverHandler());
    await actions.applyLookupAction({ collectionId, itemId, sourceId: OL_WORK_KEY });

    let hydrates = 0;
    providerServer.use(
      http.get(`${OPENLIBRARY_BASE_URL}/works/:work`, async ({ request }) => {
        hydrates += 1;
        return HttpResponse.json({
          title: "Frieren, Vol. 1 (revised)",
          covers: [-1],
          subjects: ["Fantasy fiction"],
          request: request.url,
        });
      }),
    );

    const result = await actions.rerunLookupAction({ collectionId, itemId });

    expect(hydrates).toBe(1);
    expect(result.item.title).toBe("Frieren, Vol. 1 (revised)");
  });

  it("refuses an item that was never matched", async () => {
    await expect(actions.rerunLookupAction({ collectionId, itemId })).rejects.toThrow(
      "This item isn't matched to a provider yet.",
    );
  });

  it("refuses a viewer", async () => {
    providerServer.use(missingCoverHandler());
    await actions.applyLookupAction({ collectionId, itemId, sourceId: OL_WORK_KEY });
    const viewer = await createTestUser();
    const invite = await inviteMember({
      collectionId,
      invitedEmail: viewer.email,
      role: "viewer",
      invitedBy: owner.id,
    });
    await acceptInvite(invite.inviteToken!, viewer.id, viewer.email);
    signedInAs(viewer);

    await expect(actions.rerunLookupAction({ collectionId, itemId })).rejects.toThrow("Not authorized.");
  });
});

describe("clearLookupMatchAction", () => {
  it("drops the provenance and keeps the values it filled in", async () => {
    providerServer.use(missingCoverHandler());
    const applied = await actions.applyLookupAction({ collectionId, itemId, sourceId: OL_WORK_KEY });

    const item = await actions.clearLookupMatchAction({ collectionId, itemId });

    expect(item.externalRef).toBeNull();
    // Unmatching is about the link, not about undoing an owner's shelf.
    expect(item.values).toEqual(applied.item.values);
    expect(item.title).toBe(applied.item.title);
  });

  it("refuses a stale version", async () => {
    providerServer.use(missingCoverHandler());
    const applied = await actions.applyLookupAction({ collectionId, itemId, sourceId: OL_WORK_KEY });
    const stale = new Date(new Date(applied.item.updatedAt).getTime() - 1000).toISOString();

    await expect(
      actions.clearLookupMatchAction({ collectionId, itemId, ifMatchUpdatedAt: stale }),
    ).rejects.toThrow(/changed elsewhere/);
    expect((await getItem(itemId))?.externalRef).toBeTruthy();
  });

  it("refuses a viewer", async () => {
    const viewer = await createTestUser();
    const invite = await inviteMember({
      collectionId,
      invitedEmail: viewer.email,
      role: "viewer",
      invitedBy: owner.id,
    });
    await acceptInvite(invite.inviteToken!, viewer.id, viewer.email);
    signedInAs(viewer);

    await expect(actions.clearLookupMatchAction({ collectionId, itemId })).rejects.toThrow(
      "Not authorized.",
    );
  });
});

describe("previewLookupForDraftAction", () => {
  it("answers with values for a form and writes nothing", async () => {
    const preview = await actions.previewLookupForDraftAction({ collectionId, sourceId: OL_WORK_KEY });

    expect(preview).toMatchObject({
      title: "Frieren: Beyond Journey's End, Vol. 1",
      values: { author: "Kanehito Yamada, Tsukasa Abe" },
      coverUrl: OL_COVER_URL,
    });
    expect(preview.filled).toContain("Author");
  });

  it("mirrors nothing — a cancelled dialog must not leave bytes on disk", async () => {
    // The URL is the provider's, shown as a thumbnail. Saving re-reads the same
    // (by then cached) payload from the items route, which is what mirrors it.
    providerServer.use(coverHandler());

    await actions.previewLookupForDraftAction({ collectionId, sourceId: OL_WORK_KEY });

    expect(await readdir(UPLOADS_DIR)).toEqual([]);
  });

  it("needs no item, but still needs the right to edit the collection", async () => {
    const viewer = await createTestUser();
    const invite = await inviteMember({
      collectionId,
      invitedEmail: viewer.email,
      role: "viewer",
      invitedBy: owner.id,
    });
    await acceptInvite(invite.inviteToken!, viewer.id, viewer.email);
    signedInAs(viewer);

    await expect(
      actions.previewLookupForDraftAction({ collectionId, sourceId: OL_WORK_KEY }),
    ).rejects.toThrow("Not authorized.");
  });
});
