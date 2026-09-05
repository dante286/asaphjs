import { beforeEach, describe, expect, it } from "vitest";
import { GET, PATCH } from "@/app/api/collections/[id]/view-prefs/route";
import { updateCollectionSettings } from "@/db/queries/collections";
import { acceptInvite, inviteMember } from "@/db/queries/members";
import { getViewPreferences } from "@/db/queries/view-preferences";
import { aCollection, createTestUser, type TestUser } from "@/test/db/fixtures";
import { apiRequest, routeContext } from "@/test/db/http";

/**
 * A personal layout on a shared shelf: two people looking at the same
 * collection each drag their own columns, so the row is keyed on the caller's
 * own id — which is the part of this route that can only be checked with two
 * real sessions.
 *
 * The other part is who is let in at all. A viewer may store a layout — being
 * read-only about a shelf is not being read-only about how you look at it —
 * while a caller with no session of their own, share token or not, has no id to
 * key a layout on and is refused.
 */

const SHARE_TOKEN = "tok_prefs_spec";

let owner: TestUser;
let collectionId: string;

beforeEach(async () => {
  owner = await createTestUser();
  const collection = await aCollection({ ownerId: owner.id });
  collectionId = collection.id;
  await updateCollectionSettings(collectionId, { shareToken: SHARE_TOKEN, shareEnabled: true });
});

function get(options: Parameters<typeof apiRequest>[1] = {}) {
  return GET(
    apiRequest(`/api/collections/${collectionId}/view-prefs`, { cookie: owner.cookie, ...options }),
    routeContext({ id: collectionId }),
  );
}

function patch(body: unknown, options: Parameters<typeof apiRequest>[1] = {}) {
  return PATCH(
    apiRequest(`/api/collections/${collectionId}/view-prefs`, {
      method: "PATCH",
      body,
      cookie: owner.cookie,
      ...options,
    }),
    routeContext({ id: collectionId }),
  );
}

async function asMember(role: "editor" | "viewer") {
  const user = await createTestUser();
  const invite = await inviteMember({
    collectionId,
    invitedEmail: user.email,
    role,
    invitedBy: owner.id,
  });
  await acceptInvite(invite.inviteToken!, user.id, user.email);
  return user;
}

describe("GET", () => {
  it("answers with defaults before anything is stored", async () => {
    const response = await get();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ columnWidths: {}, hiddenColumns: [] });
  });

  it("answers with what this caller stored", async () => {
    await patch({ columnWidths: { title: 320 }, hiddenColumns: ["paid"] });

    expect(await (await get()).json()).toEqual({ columnWidths: { title: 320 }, hiddenColumns: ["paid"] });
  });

  it("keeps two people's layouts apart on the same collection", async () => {
    const editor = await asMember("editor");
    await patch({ columnWidths: { title: 320 } });

    await patch({ columnWidths: { title: 500 } }, { cookie: editor.cookie });

    expect(await (await get()).json()).toMatchObject({ columnWidths: { title: 320 } });
    expect(await (await get({ cookie: editor.cookie })).json()).toMatchObject({
      columnWidths: { title: 500 },
    });
  });

  it("refuses a share-link caller", async () => {
    // `public` is left out of this route's `allowed` list on purpose: a share
    // token identifies a collection, not a person, so there is nobody to read a
    // layout back for. The share page renders its table with empty prefs and
    // never calls here.
    expect((await get({ cookie: undefined, token: SHARE_TOKEN })).status).toBe(403);
  });

  it("refuses an anonymous caller with no token", async () => {
    expect((await get({ cookie: undefined })).status).toBe(403);
  });
});

describe("PATCH", () => {
  it("merges a width in and answers with the stored result", async () => {
    await patch({ columnWidths: { title: 320 } });

    const response = await patch({ columnWidths: { console: 120 } });

    expect(await response.json()).toEqual({
      columnWidths: { title: 320, console: 120 },
      hiddenColumns: [],
    });
  });

  it("lets a viewer store their own layout", async () => {
    // Read-only about the shelf, not about how they look at it.
    const viewer = await asMember("viewer");

    const response = await patch({ hiddenColumns: ["paid"] }, { cookie: viewer.cookie });

    expect(response.status).toBe(200);
    expect(await getViewPreferences(viewer.id, collectionId)).toEqual({
      columnWidths: {},
      hiddenColumns: ["paid"],
    });
  });

  it("refuses a share-link caller's patch, and writes nothing", async () => {
    // Refused at the guard, so nothing downstream gets a chance to key a write
    // on the wrong person — the owner's stored layout is untouched.
    const response = await patch(
      { columnWidths: { title: 999 } },
      { cookie: undefined, token: SHARE_TOKEN },
    );

    expect(response.status).toBe(403);
    expect(await getViewPreferences(owner.id, collectionId)).toEqual({
      columnWidths: {},
      hiddenColumns: [],
    });
  });

  it("refuses an anonymous caller with no token", async () => {
    expect((await patch({ columnWidths: { title: 320 } }, { cookie: undefined })).status).toBe(403);
  });
});
