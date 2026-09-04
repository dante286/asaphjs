import { readdir } from "node:fs/promises";
import { beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import { DELETE, POST } from "@/app/api/collections/[id]/items/[itemId]/photo/route";
import { createItem, getItem } from "@/db/queries/items";
import { acceptInvite, inviteMember } from "@/db/queries/members";
import { MAX_UPLOAD_BYTES } from "@/lib/uploads/limits";
import { aCollection, createTestUser, writeTestUpload, type TestUser } from "@/test/db/fixtures";
import { apiRequest, routeContext } from "@/test/db/http";
import { UPLOADS_DIR } from "@/test/db/setup";

/**
 * The photo route is the only one that writes bytes to disk, so its
 * interesting assertions are about the filesystem rather than the response:
 * that the size cap is enforced twice (once on the client's claim, once on the
 * decoded part), and that a patch which fails after the file was written
 * doesn't leave the bytes orphaned in a volume nobody sweeps.
 */

let owner: TestUser;
let collectionId: string;
let itemId: string;
let png: Buffer;

beforeEach(async () => {
  owner = await createTestUser();
  const collection = await aCollection({ ownerId: owner.id });
  collectionId = collection.id;
  const item = await createItem({ collectionId, title: "Chrono Trigger" });
  itemId = item.id;
  // A real image, because saveUpload re-encodes through libvips — anything
  // else would only ever exercise the 415 branch.
  png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#2a9d8f" } })
    .png()
    .toBuffer();
});

function photoForm(bytes: Uint8Array, name = "cover.png", type = "image/png") {
  const form = new FormData();
  form.set("photo", new File([bytes as unknown as BlobPart], name, { type }));
  return form;
}

function post(body: FormData | string, options: Parameters<typeof apiRequest>[1] = {}) {
  return POST(
    apiRequest(`/api/collections/${collectionId}/items/${itemId}/photo`, {
      method: "POST",
      body,
      cookie: owner.cookie,
      ...options,
    }),
    routeContext({ id: collectionId, itemId }),
  );
}

function del(options: Parameters<typeof apiRequest>[1] = {}) {
  return DELETE(
    apiRequest(`/api/collections/${collectionId}/items/${itemId}/photo`, {
      method: "DELETE",
      cookie: owner.cookie,
      ...options,
    }),
    routeContext({ id: collectionId, itemId }),
  );
}

describe("POST", () => {
  it("stores a re-encoded WebP and its thumbnail, and puts the URL on the item", async () => {
    const response = await post(photoForm(png));

    expect(response.status).toBe(200);
    const item = await response.json();
    expect(item.coverUrl).toMatch(/^\/api\/uploads\/[A-Za-z0-9_-]{21}\.webp$/);

    // Two files: the bounded full-size copy and the grid-sized thumb, which is
    // found by name rather than stored on the row.
    const name = item.coverUrl.replace("/api/uploads/", "").replace(".webp", "");
    expect((await readdir(UPLOADS_DIR)).sort()).toEqual([`${name}.webp`, `${name}_t.webp`]);
    expect(await getItem(itemId)).toMatchObject({ coverUrl: item.coverUrl });
  });

  it("unlinks the photo it replaced", async () => {
    const previous = await writeTestUpload("previouscover0000000.webp");
    const { patchItem } = await import("@/db/queries/items");
    await patchItem(itemId, { coverUrl: previous });

    await post(photoForm(png));

    // The old pair is gone and only the new one is left — the previous cover's
    // bytes are unreachable the moment the row stops naming them.
    const files = await readdir(UPLOADS_DIR);
    expect(files).not.toContain("previouscover0000000.webp");
    expect(files).not.toContain("previouscover0000000_t.webp");
    expect(files).toHaveLength(2);
    expect((await getItem(itemId))!.coverUrl).not.toBe(previous);
  });

  it("leaves a provider cover alone when replacing it", async () => {
    const { patchItem } = await import("@/db/queries/items");
    await patchItem(itemId, { coverUrl: "https://images.igdb.com/igdb/image/upload/t_cover_big/co2i5f.jpg" });

    // Nothing to unlink, nothing to throw about — deleteUpload skips any URL
    // this app didn't mint.
    expect((await post(photoForm(png))).status).toBe(200);
  });

  it("refuses a photo with no image in it", async () => {
    const response = await post(photoForm(new TextEncoder().encode("this is not a png")));

    expect(response.status).toBe(415);
    expect(await response.json()).toEqual({
      error: "That file isn't a readable JPEG, PNG, WebP, GIF, or AVIF image.",
    });
    // The sniff happens before anything is written.
    expect(await readdir(UPLOADS_DIR)).toEqual([]);
  });

  it("refuses a request with no photo part", async () => {
    const response = await post(new FormData());

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "No photo in the request." });
  });

  it("refuses an empty file", async () => {
    const response = await post(photoForm(new Uint8Array()));

    expect(response.status).toBe(400);
  });

  describe("the size cap", () => {
    it("bails on the client's own content-length before buffering the body", async () => {
      // The cheap check: a browser that already told us the request is too big
      // doesn't get to send it. The header is trusted only to refuse.
      const response = await post(photoForm(png), {
        headers: { "content-length": String(MAX_UPLOAD_BYTES + 1024 * 1024) },
      });

      expect(response.status).toBe(413);
      expect(await response.json()).toEqual({ error: "Photos are capped at 10MB." });
      expect(await readdir(UPLOADS_DIR)).toEqual([]);
    });

    it("checks the decoded part too, for a request that lied", async () => {
      // The authoritative check. This body is over the cap but under the
      // request allowance (cap + 64KB of framing), so it gets past the header
      // check and has to be caught on the part itself.
      const response = await post(photoForm(new Uint8Array(MAX_UPLOAD_BYTES + 1)));

      expect(response.status).toBe(413);
      expect(await readdir(UPLOADS_DIR)).toEqual([]);
    });
  });

  describe("when the patch fails after the file is written", () => {
    it("deletes the orphaned bytes and answers 409", async () => {
      const item = await getItem(itemId);
      const stale = new Date(item!.updatedAt.getTime() - 1000).toISOString();

      const response = await post(photoForm(png), { headers: { "if-match": stale } });

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: "This item changed elsewhere." });
      // The row moved out from under us, so the bytes have no owner — and
      // `uploads/` is a mounted volume nothing sweeps.
      expect(await readdir(UPLOADS_DIR)).toEqual([]);
      expect(await getItem(itemId)).toMatchObject({ coverUrl: null });
    });

    it("deletes them for a 404 too", async () => {
      const { deleteItem } = await import("@/db/queries/items");
      await deleteItem(itemId);

      const response = await POST(
        apiRequest(`/api/collections/${collectionId}/items/${itemId}/photo`, {
          method: "POST",
          body: photoForm(png),
          cookie: owner.cookie,
        }),
        routeContext({ id: collectionId, itemId }),
      );

      // Caught by the pre-flight item lookup rather than by the patch, so
      // nothing was written in the first place.
      expect(response.status).toBe(404);
      expect(await readdir(UPLOADS_DIR)).toEqual([]);
    });
  });

  it("refuses an item that belongs to another collection", async () => {
    const other = await createTestUser();
    const theirs = await aCollection({ ownerId: other.id, name: "Theirs" });
    const theirItem = await createItem({ collectionId: theirs.id, title: "Theirs" });

    // The role guard passes — this caller owns the collection in the path —
    // so the item's own collection is what has to be checked.
    const response = await POST(
      apiRequest(`/api/collections/${collectionId}/items/${theirItem.id}/photo`, {
        method: "POST",
        body: photoForm(png),
        cookie: owner.cookie,
      }),
      routeContext({ id: collectionId, itemId: theirItem.id }),
    );

    expect(response.status).toBe(404);
    expect(await getItem(theirItem.id)).toMatchObject({ coverUrl: null });
  });

  it("lets an editor upload and refuses a viewer", async () => {
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

    expect((await post(photoForm(png), { cookie: editor.cookie })).status).toBe(200);
    expect((await post(photoForm(png), { cookie: viewer.cookie })).status).toBe(403);
    expect((await post(photoForm(png), { cookie: undefined })).status).toBe(403);
  });
});

describe("DELETE", () => {
  it("clears the cover and unlinks the pair", async () => {
    await post(photoForm(png));

    const response = await del();

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ coverUrl: null });
    expect(await readdir(UPLOADS_DIR)).toEqual([]);
  });

  it("leaves a provider cover's URL cleared but nothing unlinked", async () => {
    const { patchItem } = await import("@/db/queries/items");
    await patchItem(itemId, { coverUrl: "https://images.igdb.com/igdb/image/upload/t_cover_big/co2i5f.jpg" });

    expect((await del()).status).toBe(200);
    expect(await getItem(itemId)).toMatchObject({ coverUrl: null });
  });

  it("answers 409 for a stale version without clearing the cover", async () => {
    const item = await (await post(photoForm(png))).json();
    const stale = new Date(new Date(item.updatedAt).getTime() - 1000).toISOString();

    const response = await del({ headers: { "if-match": stale } });

    expect(response.status).toBe(409);
    expect(await getItem(itemId)).toMatchObject({ coverUrl: item.coverUrl });
    // The file is still the item's, so it must still be there.
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

    expect((await del({ cookie: viewer.cookie })).status).toBe(403);
  });
});
