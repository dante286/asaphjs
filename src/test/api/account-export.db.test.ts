import { beforeEach, describe, expect, it, vi } from "vitest";
import { aCollection, createTestUser, testFields, type TestUser } from "@/test/db/fixtures";
import { signedInAs, signedOut } from "@/test/db/session";
import { createItem } from "@/db/queries/items";
import { acceptInvite, inviteMember } from "@/db/queries/members";

/**
 * "Take your data with you" — the two download routes, which are thin wrappers
 * over the export actions and are tested through the routes because the
 * response headers are what make a browser save a file rather than render one.
 *
 * The interesting content assertion is CSV quoting. A value holding a comma, a
 * quote and a newline is the case that turns a working export into a file
 * whose columns silently shift, and it's the one nobody has by accident.
 */
vi.mock("next/headers", async () => {
  const { sessionHeaders } = await import("@/test/db/session");
  return { headers: async () => sessionHeaders() };
});

const csvRoute = await import("@/app/api/account/export/csv/route");
const jsonRoute = await import("@/app/api/account/export/json/route");

let owner: TestUser;

beforeEach(async () => {
  owner = await createTestUser();
  signedInAs(owner);
});

describe("the CSV export", () => {
  it("writes a section per collection, with the field labels as a header row", async () => {
    const games = await aCollection({ ownerId: owner.id, name: "Video Games" });
    await createItem({ collectionId: games.id, title: "Chrono Trigger", values: { console: "SNES", paid: 220 } });

    const response = await csvRoute.GET();
    const body = await response.text();

    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="asaph-export.csv"');
    expect(body.split("\n").slice(0, 3)).toEqual([
      "# Video Games",
      "Title,Console,Paid",
      "Chrono Trigger,SNES,220",
    ]);
  });

  it("quotes a value containing a comma, a quote or a newline", async () => {
    const collection = await aCollection({ ownerId: owner.id, name: "Books" });
    await createItem({
      collectionId: collection.id,
      title: 'The "Best" of Times, Vol. 1',
      values: { console: "line one\nline two", paid: 10 },
    });

    const body = await (await csvRoute.GET()).text();

    // Doubled quotes inside a quoted field, which is what every spreadsheet
    // reads back as one quote — and the newline stays inside the field.
    expect(body).toContain('"The ""Best"" of Times, Vol. 1"');
    expect(body).toContain('"line one\nline two"');
  });

  it("leaves an unset value as an empty cell", async () => {
    const collection = await aCollection({ ownerId: owner.id, name: "Books" });
    await createItem({ collectionId: collection.id, title: "Sparse" });

    const body = await (await csvRoute.GET()).text();

    // Not "null" or "undefined" — an empty cell is what a reimport reads as
    // unset, and this file is meant to be reimportable.
    expect(body).toContain("Sparse,,");
  });

  it("covers a collection shared with this user as well as their own", async () => {
    // The export is "everything you can see", which is what
    // listCollectionsForUser answers — an accepted share included.
    const other = await createTestUser();
    const theirs = await aCollection({ ownerId: other.id, name: "Their Shelf" });
    const invite = await inviteMember({
      collectionId: theirs.id,
      invitedEmail: owner.email,
      role: "viewer",
      invitedBy: other.id,
    });
    await acceptInvite(invite.inviteToken!, owner.id, owner.email);
    await createItem({ collectionId: theirs.id, title: "Borrowed reading" });
    await aCollection({ ownerId: owner.id, name: "Mine" });

    const body = await (await csvRoute.GET()).text();

    expect(body).toContain("# Their Shelf");
    expect(body).toContain("# Mine");
    expect(body).toContain("Borrowed reading");
  });

  it("leaves out a collection this user has no access to", async () => {
    const other = await createTestUser();
    const theirs = await aCollection({ ownerId: other.id, name: "Not Shared" });
    await createItem({ collectionId: theirs.id, title: "Private business" });

    const body = await (await csvRoute.GET()).text();

    expect(body).not.toContain("Not Shared");
    expect(body).not.toContain("Private business");
  });

  it("exports an account with nothing in it as an empty file", async () => {
    expect(await (await csvRoute.GET()).text()).toBe("");
  });

  it("refuses to answer without a session", async () => {
    signedOut();

    // `requireSession` redirects rather than returning — the route throws
    // NEXT_REDIRECT and the framework turns it into a 307 to /auth.
    await expect(csvRoute.GET()).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") });
  });
});

describe("the JSON export", () => {
  it("writes a document per collection with its fields and items", async () => {
    const collection = await aCollection({
      ownerId: owner.id,
      name: "Video Games",
      templateKey: "video_games",
    });
    await createItem({ collectionId: collection.id, title: "Chrono Trigger", values: { console: "SNES" } });

    const response = await jsonRoute.GET();

    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="asaph-export.json"');
    const parsed = JSON.parse(await response.text());
    expect(parsed).toMatchObject([
      {
        name: "Video Games",
        templateKey: "video_games",
        fields: testFields(),
        items: [{ title: "Chrono Trigger", values: { console: "SNES" } }],
      },
    ]);
  });

  it("keeps a value's own type rather than stringifying it", async () => {
    // The reason to offer JSON next to CSV: a number stays a number and a
    // checkbox stays a boolean.
    const collection = await aCollection({ ownerId: owner.id, name: "Books" });
    await createItem({
      collectionId: collection.id,
      title: "Typed",
      values: { paid: 12.5, console: null, boxed: true, tags: ["a", "b"] },
    });

    const [{ items }] = JSON.parse(await (await jsonRoute.GET()).text());

    expect(items[0].values).toEqual({ paid: 12.5, console: null, boxed: true, tags: ["a", "b"] });
  });

  it("is indented, because a person opens this file", async () => {
    await aCollection({ ownerId: owner.id, name: "Books" });

    expect(await (await jsonRoute.GET()).text()).toContain('\n  {\n    "name": "Books"');
  });

  it("exports an account with nothing in it as an empty array", async () => {
    expect(await (await jsonRoute.GET()).text()).toBe("[]");
  });

  it("refuses to answer without a session", async () => {
    signedOut();

    await expect(jsonRoute.GET()).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_REDIRECT"),
    });
  });
});
