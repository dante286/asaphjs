import { existsSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { deleteUploadsForOwner } from "./collections";
import { createItem, deleteItem } from "./items";
import { releaseUploads } from "./uploads";
import { aCollection, createTestUser, writeTestUpload } from "@/test/db/fixtures";
import { UPLOADS_DIR } from "@/test/db/setup";

/**
 * Upload files are deleted only when no item still names them. Each upload has
 * one item today, but rows from before covers were server-only may share one,
 * and deleting it for one would blank the other.
 */

const onDisk = (name: string) => existsSync(path.join(UPLOADS_DIR, name));

let collectionId: string;

beforeEach(async () => {
  collectionId = (await aCollection({ ownerId: (await createTestUser()).id })).id;
});

describe("releaseUploads", () => {
  it("unlinks a file, and its thumbnail, that nothing names", async () => {
    const url = await writeTestUpload("lonelycover000000000.webp");

    expect(await releaseUploads([url, url, null])).toBe(1);
    expect(onDisk("lonelycover000000000.webp")).toBe(false);
    expect(onDisk("lonelycover000000000_t.webp")).toBe(false);
  });

  it("keeps a file an item still names", async () => {
    const url = await writeTestUpload("stillusedcover000000.webp");
    await createItem({ collectionId, title: "Still showing it", coverUrl: url });

    expect(await releaseUploads([url])).toBe(0);
    expect(onDisk("stillusedcover000000.webp")).toBe(true);
  });
});

describe("deleting an item whose cover is shared", () => {
  it("keeps the file until the last item naming it is gone", async () => {
    const url = await writeTestUpload("sharedbytwo000000000.webp");
    const first = await createItem({ collectionId, title: "First", coverUrl: url });
    const second = await createItem({ collectionId, title: "Second", coverUrl: url });

    await deleteItem(collectionId, first.id);
    expect(onDisk("sharedbytwo000000000.webp")).toBe(true);

    await deleteItem(collectionId, second.id);
    expect(onDisk("sharedbytwo000000000.webp")).toBe(false);
  });
});

describe("deleteUploadsForOwner", () => {
  it("sweeps the owner's own files but keeps one another owner's item still shows", async () => {
    const owner = await createTestUser();
    const mine = await aCollection({ ownerId: owner.id, name: "Mine" });
    const onlyMine = await writeTestUpload("onlymine000000000000.webp");
    const shared = await writeTestUpload("sharedwithother00000.webp");
    await createItem({ collectionId: mine.id, title: "A", coverUrl: onlyMine });
    await createItem({ collectionId: mine.id, title: "B", coverUrl: shared });
    // Runs before the cascade, so the owner's own rows still exist here and
    // must not count as references; the other owner's must.
    await createItem({ collectionId, title: "Elsewhere", coverUrl: shared });

    expect(await deleteUploadsForOwner(owner.id)).toBe(1);
    expect(onDisk("onlymine000000000000.webp")).toBe(false);
    expect(onDisk("sharedwithother00000.webp")).toBe(true);
  });
});
