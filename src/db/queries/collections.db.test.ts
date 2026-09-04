import { existsSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createCollection,
  deleteCollection,
  deleteUploadsForOwner,
  getCollectionById,
  getCollectionByShareToken,
  getCollectionForUser,
  listCollectionsForUser,
  listOwnedCollections,
  updateCollectionFields,
  updateCollectionSettings,
} from "./collections";
import { createItem } from "./items";
import { acceptInvite, inviteMember } from "./members";
import { aCollection, createTestUser, testFields, writeTestUpload, type TestUser } from "@/test/db/fixtures";
import { UPLOADS_DIR } from "@/test/db/setup";

/**
 * The slug system is why this tier exists. `uniqueSlug` reads and the caller
 * then writes, so the free slug it found can be claimed in between — and
 * `withFreshSlug` exists to survive that. No unit test can reach it: the
 * behaviour only exists across genuinely concurrent connections against a real
 * unique index.
 */

let owner: TestUser;

beforeEach(async () => {
  owner = await createTestUser();
});

describe("createCollection", () => {
  it("mints the slug from the name", async () => {
    const row = await aCollection({ ownerId: owner.id, name: "Video Games" });

    expect(row).toMatchObject({
      name: "Video Games",
      slug: "video-games",
      ownerId: owner.id,
      defaultView: "covers",
      features: {},
      importMappings: {},
      shareEnabled: false,
      shareToken: null,
    });
  });

  it("copies the field defs onto the row rather than referencing a template", async () => {
    const fields = testFields();
    const row = await aCollection({ ownerId: owner.id, fields, templateKey: "video_games" });

    expect(row.fields).toEqual(fields);
    expect(row.templateKey).toBe("video_games");
  });

  it("walks suffixes when the name is taken, across owners", async () => {
    // The unique index is global, not per owner: `/collections/:slug` has no
    // owner in it, so two people naming a collection "Movies" can't both have
    // `movies`.
    const second = await createTestUser();
    const third = await createTestUser();

    const a = await aCollection({ ownerId: owner.id, name: "Movies" });
    const b = await aCollection({ ownerId: second.id, name: "Movies" });
    const c = await aCollection({ ownerId: third.id, name: "movies!" });

    expect([a.slug, b.slug, c.slug]).toEqual(["movies", "movies-2", "movies-3"]);
  });

  it("walks past a suffix a name of its own already claimed", async () => {
    // "Movies 2" slugifies to the same thing the suffix walk would have minted
    // for a second "Movies", so the walk has to keep going rather than assume
    // `-2` is free.
    const a = await aCollection({ ownerId: owner.id, name: "Movies" });
    const b = await aCollection({ ownerId: owner.id, name: "Movies 2" });
    const c = await aCollection({ ownerId: owner.id, name: "Movies" });

    expect([a.slug, b.slug, c.slug]).toEqual(["movies", "movies-2", "movies-3"]);
  });

  it("gives two unnameable collections distinct URLs", async () => {
    // Every name with no Latin characters slugifies to "collection", so the
    // suffix walk is the only thing keeping them apart.
    const a = await aCollection({ ownerId: owner.id, name: "葬送のフリーレン" });
    const b = await aCollection({ ownerId: owner.id, name: "ドラゴンボール" });

    expect([a.slug, b.slug]).toEqual(["collection", "collection-2"]);
  });

  /**
   * The test `withFreshSlug` was written for. Without its retry loop these
   * requests race between `uniqueSlug`'s read and the insert, and the losers
   * fail on `collections_slug_unique` with a slug that really was free when
   * they picked it. Measured on Postgres 18, three simultaneous creates of one
   * name failed 10 of 30 without the retry; with it, all three land.
   */
  it("survives three simultaneous creates of the same name", async () => {
    const [a, b, c] = await Promise.all([
      createCollection({ ownerId: owner.id, name: "Movies", templateKey: null, fields: testFields() }),
      createCollection({ ownerId: owner.id, name: "Movies", templateKey: null, fields: testFields() }),
      createCollection({ ownerId: owner.id, name: "Movies", templateKey: null, fields: testFields() }),
    ]);

    // All three succeeded, and the slugs are distinct — which is the only thing
    // the unique index would ever have allowed.
    expect(new Set([a.slug, b.slug, c.slug]).size).toBe(3);
    expect([a.slug, b.slug, c.slug].sort()).toEqual(["movies", "movies-2", "movies-3"]);
  });

  it("propagates a write error that isn't a slug collision", async () => {
    // The retry loop only swallows `collections_slug_unique`. Anything else —
    // here a foreign key violation on the owner — has to reach the caller
    // rather than be retried eight times and then thrown anyway.
    const err = await createCollection({
      ownerId: "no-such-user",
      name: "Movies",
      templateKey: null,
      fields: testFields(),
    }).catch((e: unknown) => e);

    // Drizzle wraps driver errors, so the pg code lives on `cause` — the same
    // nesting `isSlugCollision` walks to recognise the one error it retries.
    expect((err as { cause?: { code?: string } }).cause?.code).toBe("23503");
  });

  it("keeps every one of eight simultaneous creates", async () => {
    // Eight is where SLUG_ATTEMPTS was set from: attempts are only spent by
    // writes that actually collide, and this is well past what a shelf-tracking
    // app meets.
    const created = await Promise.all(
      Array.from({ length: 8 }, () =>
        createCollection({ ownerId: owner.id, name: "Books", templateKey: null, fields: testFields() }),
      ),
    );

    expect(new Set(created.map((c) => c.slug)).size).toBe(8);
  });
});

describe("getCollectionForUser", () => {
  it("answers for the owner", async () => {
    const collection = await aCollection({ ownerId: owner.id });

    expect(await getCollectionForUser(owner.id, collection.slug)).toMatchObject({ id: collection.id });
  });

  it("answers for a member who has accepted", async () => {
    const collection = await aCollection({ ownerId: owner.id });
    const guest = await createTestUser();
    const invite = await inviteMember({
      collectionId: collection.id,
      invitedEmail: guest.email,
      role: "viewer",
      invitedBy: owner.id,
    });
    await acceptInvite(invite.inviteToken!, guest.id, guest.email);

    expect(await getCollectionForUser(guest.id, collection.slug)).toMatchObject({ id: collection.id });
  });

  it("refuses a member who was invited but hasn't accepted", async () => {
    const collection = await aCollection({ ownerId: owner.id });
    const guest = await createTestUser();
    await inviteMember({
      collectionId: collection.id,
      invitedEmail: guest.email,
      role: "editor",
      invitedBy: owner.id,
    });

    expect(await getCollectionForUser(guest.id, collection.slug)).toBeNull();
  });

  it("refuses a stranger", async () => {
    const collection = await aCollection({ ownerId: owner.id });
    const stranger = await createTestUser();

    expect(await getCollectionForUser(stranger.id, collection.slug)).toBeNull();
  });

  /**
   * The regression this query was rewritten for. It used to look for a
   * collection the viewer owned first and only then for a shared one, so a
   * collection shared with you was unreachable whenever you owned one with the
   * same name.
   */
  it("reaches a shared collection even when the viewer owns one of the same name", async () => {
    const other = await createTestUser();
    const mine = await aCollection({ ownerId: owner.id, name: "Movies" });
    const theirs = await aCollection({ ownerId: other.id, name: "Movies" });
    const invite = await inviteMember({
      collectionId: theirs.id,
      invitedEmail: owner.email,
      role: "viewer",
      invitedBy: other.id,
    });
    await acceptInvite(invite.inviteToken!, owner.id, owner.email);

    expect(mine.slug).toBe("movies");
    expect(theirs.slug).toBe("movies-2");
    // Both reachable, each at its own URL.
    expect(await getCollectionForUser(owner.id, "movies")).toMatchObject({ id: mine.id });
    expect(await getCollectionForUser(owner.id, "movies-2")).toMatchObject({ id: theirs.id });
  });

  it("answers nothing for a slug that doesn't exist", async () => {
    expect(await getCollectionForUser(owner.id, "no-such-shelf")).toBeNull();
  });
});

describe("listCollectionsForUser", () => {
  it("counts items, verified items and lent items per collection", async () => {
    const collection = await aCollection({ ownerId: owner.id });
    await createItem({ collectionId: collection.id, title: "Chrono Trigger", verified: true });
    await createItem({ collectionId: collection.id, title: "Earthbound", borrower: "Alex" });
    await createItem({ collectionId: collection.id, title: "Super Metroid", verified: true, borrower: "Sam" });

    const [card] = await listCollectionsForUser(owner.id);

    expect(card).toMatchObject({
      isOwner: true,
      ownerName: owner.name,
      itemCount: 3,
      verifiedCount: 2,
      lentCount: 2,
    });
  });

  it("counts an empty collection as zero rather than dropping it", async () => {
    // A left join with no items gives one row of nulls; `count(items.id)` is
    // what makes that a 0 instead of a 1.
    await aCollection({ ownerId: owner.id });

    expect(await listCollectionsForUser(owner.id)).toMatchObject([{ itemCount: 0, verifiedCount: 0 }]);
  });

  it("includes an accepted share, marked as someone else's", async () => {
    const other = await createTestUser();
    const theirs = await aCollection({ ownerId: other.id, name: "Their Books" });
    const invite = await inviteMember({
      collectionId: theirs.id,
      invitedEmail: owner.email,
      role: "editor",
      invitedBy: other.id,
    });
    await acceptInvite(invite.inviteToken!, owner.id, owner.email);

    const cards = await listCollectionsForUser(owner.id);

    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ isOwner: false, ownerName: other.name });
  });

  it("leaves out an invite nobody accepted", async () => {
    const other = await createTestUser();
    const theirs = await aCollection({ ownerId: other.id, name: "Their Books" });
    await inviteMember({
      collectionId: theirs.id,
      invitedEmail: owner.email,
      role: "editor",
      invitedBy: other.id,
    });

    expect(await listCollectionsForUser(owner.id)).toEqual([]);
  });

  it("puts the most recently updated collection first", async () => {
    const first = await aCollection({ ownerId: owner.id, name: "Books" });
    await aCollection({ ownerId: owner.id, name: "Movies" });
    // Touching `first` moves it to the top, which is the ordering the shelf
    // grid is built on.
    await updateCollectionSettings(first.id, { defaultView: "table" });

    expect((await listCollectionsForUser(owner.id)).map((c) => c.collection.name)).toEqual([
      "Books",
      "Movies",
    ]);
  });
});

describe("listOwnedCollections", () => {
  it("returns only this user's, by name", async () => {
    const other = await createTestUser();
    await aCollection({ ownerId: owner.id, name: "Movies" });
    await aCollection({ ownerId: owner.id, name: "Books" });
    await aCollection({ ownerId: other.id, name: "Anime" });

    expect((await listOwnedCollections(owner.id)).map((c) => c.name)).toEqual(["Books", "Movies"]);
  });
});

describe("getCollectionByShareToken", () => {
  it("answers only while sharing is enabled", async () => {
    const collection = await aCollection({ ownerId: owner.id });
    await updateCollectionSettings(collection.id, { shareToken: "tok_abc", shareEnabled: true });

    expect(await getCollectionByShareToken("tok_abc")).toMatchObject({ id: collection.id });

    // Turning the link off has to make the token dead without clearing it, so
    // switching sharing back on doesn't invalidate a link already handed out.
    await updateCollectionSettings(collection.id, { shareEnabled: false });
    expect(await getCollectionByShareToken("tok_abc")).toBeUndefined();
  });

  it("answers nothing for an unknown token", async () => {
    expect(await getCollectionByShareToken("tok_nope")).toBeUndefined();
  });
});

describe("updateCollectionSettings", () => {
  it("moves the slug with the name", async () => {
    const collection = await aCollection({ ownerId: owner.id, name: "Movies" });

    const updated = await updateCollectionSettings(collection.id, { name: "Films" });

    // Deliberate: the slug follows the name here rather than in the action, so
    // no caller can rename a collection and leave its URL behind.
    expect(updated).toMatchObject({ name: "Films", slug: "films" });
  });

  it("keeps the slug when the name is unchanged", async () => {
    const collection = await aCollection({ ownerId: owner.id, name: "Movies" });

    const updated = await updateCollectionSettings(collection.id, { name: "Movies" });

    // `excludeId` is what stops a collection colliding with its own row and
    // creeping to `movies-2` for no reason.
    expect(updated.slug).toBe("movies");
  });

  it("suffixes a rename onto a name someone else holds", async () => {
    const other = await createTestUser();
    await aCollection({ ownerId: other.id, name: "Movies" });
    const mine = await aCollection({ ownerId: owner.id, name: "Films" });

    expect((await updateCollectionSettings(mine.id, { name: "Movies" })).slug).toBe("movies-2");
  });

  it("leaves the slug alone for a patch that isn't a rename", async () => {
    const collection = await aCollection({ ownerId: owner.id, name: "Movies" });

    const updated = await updateCollectionSettings(collection.id, {
      defaultView: "table",
      features: { lookup: "tmdb" },
      importMappings: { Title: "title" },
    });

    expect(updated).toMatchObject({
      slug: "movies",
      defaultView: "table",
      features: { lookup: "tmdb" },
      importMappings: { Title: "title" },
    });
  });

  it("survives simultaneous renames onto one name", async () => {
    // The other half of what `withFreshSlug` guards: renames go through the
    // same read-then-write gap as creates, and four at once on one name reach
    // it just as reliably.
    const created = await Promise.all(
      ["Alpha", "Beta", "Gamma", "Delta"].map((name) => aCollection({ ownerId: owner.id, name })),
    );

    const renamed = await Promise.all(
      created.map((c) => updateCollectionSettings(c.id, { name: "Shelf" })),
    );

    expect(new Set(renamed.map((c) => c.slug)).size).toBe(4);
    expect(renamed.every((c) => c.name === "Shelf")).toBe(true);
  });
});

describe("updateCollectionFields", () => {
  it("replaces the field defs and touches updatedAt", async () => {
    const collection = await aCollection({ ownerId: owner.id });
    const fields = [...testFields(), { id: "region", label: "Region", type: "select" as const, order: 3, origin: "custom" as const }];

    const updated = await updateCollectionFields(collection.id, fields);

    expect(updated.fields).toEqual(fields);
    expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(collection.updatedAt.getTime());
  });
});

describe("deleteCollection", () => {
  it("takes its items with it", async () => {
    const collection = await aCollection({ ownerId: owner.id });
    const item = await createItem({ collectionId: collection.id, title: "Chrono Trigger" });

    await deleteCollection(collection.id);

    expect(await getCollectionById(collection.id)).toBeUndefined();
    // Via `on delete cascade`, which the app never sees row by row — the reason
    // the covers have to be read before the delete.
    const { db } = await import("@/db/client");
    expect(await db.query.items.findFirst({ where: (i, { eq }) => eq(i.id, item.id) })).toBeUndefined();
  });

  it("unlinks the covers its items were holding", async () => {
    const collection = await aCollection({ ownerId: owner.id });
    const coverUrl = await writeTestUpload("collectioncover000000.webp");
    await createItem({ collectionId: collection.id, title: "Chrono Trigger", coverUrl });

    await deleteCollection(collection.id);

    expect(existsSync(path.join(UPLOADS_DIR, "collectioncover000000.webp"))).toBe(false);
    expect(existsSync(path.join(UPLOADS_DIR, "collectioncover000000_t.webp"))).toBe(false);
  });

  it("leaves a provider cover alone", async () => {
    const collection = await aCollection({ ownerId: owner.id });
    await createItem({
      collectionId: collection.id,
      title: "Chrono Trigger",
      coverUrl: "https://images.igdb.com/igdb/image/upload/t_cover_big/co2i5f.jpg",
    });

    // Nothing to unlink and nothing to throw about — `deleteUploads` skips any
    // URL this app didn't mint.
    await expect(deleteCollection(collection.id)).resolves.toBeUndefined();
  });
});

describe("deleteUploadsForOwner", () => {
  it("sweeps the covers under collections this user owns", async () => {
    const collection = await aCollection({ ownerId: owner.id });
    const coverUrl = await writeTestUpload("ownercover0000000000.webp");
    await createItem({ collectionId: collection.id, title: "Chrono Trigger", coverUrl });

    // Called from Better Auth's `beforeDelete`, while the rows a cascade is
    // about to remove can still be read.
    expect(await deleteUploadsForOwner(owner.id)).toBe(1);
    expect(existsSync(path.join(UPLOADS_DIR, "ownercover0000000000.webp"))).toBe(false);
  });

  it("leaves someone else's collection alone, even one this user edits", async () => {
    // An editor can upload a photo to a collection belonging to somebody else,
    // and that item survives this user's deletion — unlinking its file would
    // blank a cover in a collection whose owner never asked for anything.
    const other = await createTestUser();
    const theirs = await aCollection({ ownerId: other.id, name: "Their Games" });
    const invite = await inviteMember({
      collectionId: theirs.id,
      invitedEmail: owner.email,
      role: "editor",
      invitedBy: other.id,
    });
    await acceptInvite(invite.inviteToken!, owner.id, owner.email);
    const coverUrl = await writeTestUpload("theircover0000000000.webp");
    await createItem({ collectionId: theirs.id, title: "Uploaded by the editor", coverUrl });

    expect(await deleteUploadsForOwner(owner.id)).toBe(0);
    expect(existsSync(path.join(UPLOADS_DIR, "theircover0000000000.webp"))).toBe(true);
  });

  it("counts one file once when several items share a cover", async () => {
    const collection = await aCollection({ ownerId: owner.id });
    const coverUrl = await writeTestUpload("sharedcover000000000.webp");
    await createItem({ collectionId: collection.id, title: "Disc 1", coverUrl });
    await createItem({ collectionId: collection.id, title: "Disc 2", coverUrl });

    expect(await deleteUploadsForOwner(owner.id)).toBe(1);
  });
});
