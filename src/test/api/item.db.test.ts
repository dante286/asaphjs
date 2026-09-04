import { beforeEach, describe, expect, it } from "vitest";
import { DELETE, PATCH } from "@/app/api/collections/[id]/items/[itemId]/route";
import { createItem, getItem } from "@/db/queries/items";
import { acceptInvite, inviteMember } from "@/db/queries/members";
import { aCollection, createTestUser, type TestUser } from "@/test/db/fixtures";
import { apiRequest, routeContext } from "@/test/db/http";

/**
 * The per-field autosave endpoint. Two things here are the route's own rather
 * than the query layer's: it turns a conflict into a 409 carrying the row that
 * won, and it deletes `externalRef` from the body so a client cannot claim an
 * item was matched from a provider it never was.
 */

let owner: TestUser;
let collectionId: string;
let itemId: string;

beforeEach(async () => {
  owner = await createTestUser();
  const collection = await aCollection({ ownerId: owner.id });
  collectionId = collection.id;
  const item = await createItem({
    collectionId,
    title: "Chrono Trigger",
    values: { console: "SNES", paid: 220 },
  });
  itemId = item.id;
});

function patch(body: unknown, options: Parameters<typeof apiRequest>[1] = {}) {
  return PATCH(
    apiRequest(`/api/collections/${collectionId}/items/${itemId}`, {
      method: "PATCH",
      body,
      cookie: owner.cookie,
      ...options,
    }),
    routeContext({ id: collectionId, itemId }),
  );
}

function del(options: Parameters<typeof apiRequest>[1] = {}) {
  return DELETE(
    apiRequest(`/api/collections/${collectionId}/items/${itemId}`, {
      method: "DELETE",
      cookie: owner.cookie,
      ...options,
    }),
    routeContext({ id: collectionId, itemId }),
  );
}

describe("PATCH", () => {
  it("applies a single-field patch and answers with the row", async () => {
    const response = await patch({ values: { console: "SNES Mini" } });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      // Merged, not replaced — this is one field of an autosave.
      values: { console: "SNES Mini", paid: 220 },
    });
  });

  it("lets an editor patch and refuses a viewer", async () => {
    const editor = await createTestUser();
    const viewer = await createTestUser();
    for (const [user, role] of [
      [editor, "editor"],
      [viewer, "viewer"],
    ] as const) {
      const invite = await inviteMember({
        collectionId,
        invitedEmail: user.email,
        role,
        invitedBy: owner.id,
      });
      await acceptInvite(invite.inviteToken!, user.id, user.email);
    }

    expect((await patch({ title: "By the editor" }, { cookie: editor.cookie })).status).toBe(200);
    expect((await patch({ title: "By the viewer" }, { cookie: viewer.cookie })).status).toBe(403);
    expect((await patch({ title: "By nobody" }, { cookie: undefined })).status).toBe(403);
  });

  it("strips a client-supplied externalRef", async () => {
    // Provenance is the metadata actions' to write. A client that could set it
    // would be able to show "matched from IGDB" on an item that never was.
    const response = await patch({
      title: "Chrono Trigger",
      externalRef: { source: "igdb", id: "1017", fetchedAt: "2026-01-01T00:00:00.000Z" },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ title: "Chrono Trigger", externalRef: null });
    expect(await getItem(itemId)).toMatchObject({ externalRef: null });
  });

  it("strips it without dropping the rest of the patch", async () => {
    const response = await patch({
      values: { console: "SFC" },
      externalRef: { source: "igdb", id: "1017", fetchedAt: "2026-01-01T00:00:00.000Z" },
    });

    expect((await response.json()).values).toEqual({ console: "SFC", paid: 220 });
  });

  describe("If-Match", () => {
    it("applies the patch when the version matches", async () => {
      const item = await getItem(itemId);

      const response = await patch(
        { title: "Renamed" },
        { headers: { "if-match": item!.updatedAt.toISOString() } },
      );

      expect(response.status).toBe(200);
    });

    it("answers 409 with the row that won", async () => {
      const item = await getItem(itemId);
      const stale = item!.updatedAt.toISOString();
      await patch({ title: "Renamed by someone else" });

      const response = await patch({ title: "Renamed by me" }, { headers: { "if-match": stale } });

      // The current row rides along with the refusal so the conflict UI can
      // show what the other writer put there without a second request.
      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body.error).toBe("This item changed elsewhere.");
      expect(body.current).toMatchObject({ title: "Renamed by someone else" });
    });

    it("leaves the row alone when it refuses", async () => {
      const item = await getItem(itemId);
      const stale = new Date(item!.updatedAt.getTime() - 1000).toISOString();

      await patch({ title: "Nope", values: { console: null } }, { headers: { "if-match": stale } });

      expect(await getItem(itemId)).toMatchObject({
        title: "Chrono Trigger",
        values: { console: "SNES", paid: 220 },
      });
    });
  });

  it("answers 404 for an item that isn't there", async () => {
    const missing = "00000000-0000-0000-0000-000000000000";

    const response = await PATCH(
      apiRequest(`/api/collections/${collectionId}/items/${missing}`, {
        method: "PATCH",
        body: { title: "x" },
        cookie: owner.cookie,
      }),
      routeContext({ id: collectionId, itemId: missing }),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Item not found." });
  });

  it("checks the role against the collection in the path", async () => {
    // The guard is on the collection, and the item id is used as given — so a
    // caller with rights to their own collection can't patch someone else's
    // item through it. What stops that is the collection they name being one
    // they may write to *and* the item belonging to it.
    const other = await createTestUser();
    const theirCollection = await aCollection({ ownerId: other.id, name: "Theirs" });
    const theirItem = await createItem({ collectionId: theirCollection.id, title: "Theirs" });

    const response = await PATCH(
      apiRequest(`/api/collections/${theirCollection.id}/items/${theirItem.id}`, {
        method: "PATCH",
        body: { title: "Hijacked" },
        cookie: owner.cookie,
      }),
      routeContext({ id: theirCollection.id, itemId: theirItem.id }),
    );

    expect(response.status).toBe(403);
    expect(await getItem(theirItem.id)).toMatchObject({ title: "Theirs" });
  });
});

describe("DELETE", () => {
  it("removes the item and answers 204 with no body", async () => {
    const response = await del();

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(await getItem(itemId)).toBeUndefined();
  });

  it("refuses a viewer and an anonymous caller", async () => {
    const viewer = await createTestUser();
    const invite = await inviteMember({
      collectionId,
      invitedEmail: viewer.email,
      role: "viewer",
      invitedBy: owner.id,
    });
    await acceptInvite(invite.inviteToken!, viewer.id, viewer.email);

    expect((await del({ cookie: viewer.cookie })).status).toBe(403);
    expect((await del({ cookie: undefined })).status).toBe(403);
    expect(await getItem(itemId)).toBeTruthy();
  });

  it("answers 204 for an item that was already gone", async () => {
    await del();

    // Idempotent: the second delete of a row the first removed is the state the
    // caller asked for, not an error to show them.
    expect((await del()).status).toBe(204);
  });
});
