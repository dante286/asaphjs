import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCollectionById, getCollectionForUser } from "@/db/queries/collections";
import { acceptInvite, inviteMember } from "@/db/queries/members";
import { aCollection, createTestUser, testFields, type TestUser } from "@/test/db/fixtures";
import { signedInAs, signedOut } from "@/test/db/session";
import type { FieldDef } from "@/lib/fields/field-def";

/**
 * These actions split their guard two ways — an editor may change a
 * collection's fields, only the owner may rename, share or delete it — and a
 * Server Action is a public POST endpoint whatever the UI renders. That split
 * is what this file is for; the writes themselves are the query layer's and
 * are tested there.
 *
 * The patches are parsed rather than merely typed, because
 * `updateCollectionSettings` spreads its argument straight into a Drizzle
 * `.set()`: the owner guard says who may write, not what.
 */
vi.mock("next/headers", async () => {
  const { sessionHeaders } = await import("@/test/db/session");
  return { headers: async () => sessionHeaders() };
});

const nextCache = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/cache", () => nextCache);

const actions = await import("./collections");

let owner: TestUser;
let editor: TestUser;
let viewer: TestUser;
let collectionId: string;

beforeEach(async () => {
  nextCache.refresh.mockClear();
  owner = await createTestUser();
  editor = await createTestUser();
  viewer = await createTestUser();
  const collection = await aCollection({ ownerId: owner.id });
  collectionId = collection.id;

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

  signedInAs(owner);
});

describe("createCollectionAction", () => {
  it("creates the collection and lands on its URL", async () => {
    const error = await actions
      .createCollectionAction({
        name: "Movies",
        templateKey: "movies",
        fields: testFields(),
        defaultView: "covers",
      })
      .catch((e: unknown) => e);

    // The redirect is the action's return value: `redirect` works by throwing.
    expect((error as { digest: string }).digest).toBe("NEXT_REDIRECT;replace;/collections/movies;307;");
    expect(await getCollectionForUser(owner.id, "movies")).toMatchObject({
      name: "Movies",
      templateKey: "movies",
    });
  });

  it("defaults the view rather than requiring one", async () => {
    // The parameter type is the schema's *output*, so a typed caller can't omit
    // `defaultView` — but a Server Action receives a POST body, which nothing
    // type-checks. The schema's default is what covers that.
    const wireInput = { name: "Books", templateKey: null, fields: testFields() };

    await actions
      .createCollectionAction(wireInput as Parameters<typeof actions.createCollectionAction>[0])
      .catch(() => {});

    expect(await getCollectionForUser(owner.id, "books")).toMatchObject({ defaultView: "covers" });
  });

  it("refuses a collection with no fields", async () => {
    // A shelf with no columns can't render a table or a card, and the field
    // list is what every view reads.
    await expect(
      actions.createCollectionAction({
        name: "Empty",
        templateKey: null,
        fields: [],
        defaultView: "covers",
      }),
    ).rejects.toThrow();
  });

  it("refuses a provider key it doesn't know", async () => {
    await expect(
      actions.createCollectionAction({
        name: "Video Games",
        templateKey: null,
        fields: testFields(),
        defaultView: "covers",
        features: { lookup: "wikipedia" } as unknown as { lookup: undefined },
      }),
    ).rejects.toThrow();
  });

  it("needs a session", async () => {
    signedOut();

    await expect(
      actions.createCollectionAction({
        name: "Video Games",
        templateKey: null,
        fields: testFields(),
        defaultView: "covers",
      }),
    ).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") });
  });
});

describe("updateFieldsAction", () => {
  const withRegion: FieldDef[] = [
    ...testFields(),
    { id: "region", label: "Region", type: "select", order: 3, origin: "custom" },
  ];

  it("lets the owner change the fields", async () => {
    await actions.updateFieldsAction(collectionId, withRegion);

    expect((await getCollectionById(collectionId))?.fields).toEqual(withRegion);
  });

  it("lets an editor change them too", async () => {
    // Adding a column is filling in the shelf, which is what an editor is for.
    signedInAs(editor);

    await actions.updateFieldsAction(collectionId, withRegion);

    expect((await getCollectionById(collectionId))?.fields).toHaveLength(4);
  });

  it("refuses a viewer and a stranger, and writes nothing", async () => {
    const stranger = await createTestUser();

    for (const user of [viewer, stranger]) {
      signedInAs(user);
      await expect(actions.updateFieldsAction(collectionId, withRegion)).rejects.toThrow("Not authorized.");
    }

    expect((await getCollectionById(collectionId))?.fields).toEqual(testFields());
  });

  it("refuses a field list that isn't one", async () => {
    await expect(
      actions.updateFieldsAction(collectionId, [
        { id: "broken", label: "Broken" } as unknown as FieldDef,
      ]),
    ).rejects.toThrow();
  });
});

describe("updateCollectionSettingsAction", () => {
  it("renames, moves the slug, and re-renders", async () => {
    const result = await actions.updateCollectionSettingsAction(collectionId, { name: "Films" });

    expect(result).toEqual({ name: "Films", slug: "films" });
    // Without the refresh the page that called this keeps showing the old name.
    expect(nextCache.refresh).toHaveBeenCalledOnce();
  });

  it("refuses an editor", async () => {
    // The owner-only half of the split: renaming changes the collection's URL
    // and sharing decides who can see it.
    signedInAs(editor);

    await expect(
      actions.updateCollectionSettingsAction(collectionId, { name: "Renamed by the editor" }),
    ).rejects.toThrow("Only the owner can do that.");
    expect((await getCollectionById(collectionId))?.name).toBe("Video Games");
  });

  it("refuses an empty name with a message a form can show", async () => {
    await expect(
      actions.updateCollectionSettingsAction(collectionId, { name: "   " }),
    ).rejects.toThrow("Give the collection a name.");
  });

  it("drops a patch key that isn't a setting", async () => {
    // The reason the patch is parsed at all: this object is spread into a
    // `.set()`, so an unlisted key would be a column write the guard never
    // sanctioned. Zod's answer is to strip it — the write happens without it.
    const result = await actions.updateCollectionSettingsAction(collectionId, {
      ownerId: "somebody-else",
    } as unknown as { name: string });

    expect(result).toEqual({ name: "Video Games", slug: "video-games" });
    expect((await getCollectionById(collectionId))?.ownerId).toBe(owner.id);
  });

  it("takes the settings a form does send", async () => {
    const result = await actions.updateCollectionSettingsAction(collectionId, {
      defaultView: "table",
      features: { lending: true, lookup: "openlibrary" },
    });

    expect(result.slug).toBe("video-games");
    expect(await getCollectionById(collectionId)).toMatchObject({
      defaultView: "table",
      features: { lending: true, lookup: "openlibrary" },
    });
  });
});

describe("deleteCollectionAction", () => {
  it("deletes it and re-renders in place", async () => {
    await actions.deleteCollectionAction(collectionId);

    expect(await getCollectionById(collectionId)).toBeUndefined();
    // Deleting happens from account settings, where there may be more
    // collections to manage — so re-render rather than navigate away.
    expect(nextCache.refresh).toHaveBeenCalledOnce();
  });

  it("refuses an editor", async () => {
    signedInAs(editor);

    await expect(actions.deleteCollectionAction(collectionId)).rejects.toThrow(
      "Only the owner can do that.",
    );
    expect(await getCollectionById(collectionId)).toBeTruthy();
  });

  it("refuses a stranger", async () => {
    const stranger = await createTestUser();
    signedInAs(stranger);

    await expect(actions.deleteCollectionAction(collectionId)).rejects.toThrow(
      "Only the owner can do that.",
    );
    expect(await getCollectionById(collectionId)).toBeTruthy();
  });
});

describe("getCollectionOr404", () => {
  it("throws for a collection that isn't there", async () => {
    await expect(actions.getCollectionOr404("00000000-0000-0000-0000-000000000000")).rejects.toThrow(
      "Collection not found.",
    );
  });

  it("answers with the row for one that is", async () => {
    expect(await actions.getCollectionOr404(collectionId)).toMatchObject({ id: collectionId });
  });
});
