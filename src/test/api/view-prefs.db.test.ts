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
 * while a share-link caller is refused, despite a branch in the route that
 * reads as though it wouldn't be (#47).
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

  it("refuses a public caller", async () => {
    /**
     * The route reads as though a share-link caller gets defaults back — there
     * is a `!guard.userId` branch and a comment about not erroring in the UI.
     * It can't run: `public` isn't in this route's `allowed` list, so the guard
     * refuses first, and no signed-in role ever has a null userId. Nothing
     * public calls this route either (the share page renders its table with
     * empty prefs), so this asserts what actually happens. Tracked as #47.
     */
    await patch({ columnWidths: { title: 320 } });

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

  it("refuses a public caller's patch, and writes nothing", async () => {
    // Same dead branch as on GET (#47). What matters either way is that a
    // share token can't write a layout — and it doesn't.
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
