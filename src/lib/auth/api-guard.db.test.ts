import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";
import { updateCollectionSettings } from "@/db/queries/collections";
import { acceptInvite, inviteMember } from "@/db/queries/members";
import { aCollection, createTestUser, type TestUser } from "@/test/db/fixtures";
import { apiRequest } from "@/test/db/http";
import { isGuardResponse, requireRole } from "./api-guard";
import type { Role } from "@/types";

/**
 * One function gates every route handler in the app, so it is tested as a
 * matrix rather than along the happy path: five kinds of caller against the
 * `allowed` sets the handlers actually pass. A hole here is an editor reaching
 * an owner-only action, which is precisely what clicking through the UI as one
 * user at a time never shows you.
 *
 * `requireRole` reads `request.headers`, not `next/headers`, so these are real
 * sessions on hand-built requests — the same cookie Better Auth would have set
 * in a browser, validated by the same code.
 */

const SHARE_TOKEN = "tok_guard_spec";

let owner: TestUser;
let editor: TestUser;
let viewer: TestUser;
let stranger: TestUser;
let collectionId: string;

beforeEach(async () => {
  owner = await createTestUser({ name: "Owner" });
  editor = await createTestUser({ name: "Editor" });
  viewer = await createTestUser({ name: "Viewer" });
  stranger = await createTestUser({ name: "Stranger" });

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

  await updateCollectionSettings(collectionId, { shareToken: SHARE_TOKEN, shareEnabled: true });
});

/** The five callers a handler can see, named the way the matrix reads. */
function callers() {
  return {
    owner: { cookie: owner.cookie },
    editor: { cookie: editor.cookie },
    viewer: { cookie: viewer.cookie },
    shareLink: { token: SHARE_TOKEN },
    anonymous: {},
  };
}

async function guardFor(caller: keyof ReturnType<typeof callers>, allowed: Role[]) {
  return requireRole(apiRequest(`/api/collections/${collectionId}/items`, callers()[caller]), collectionId, allowed);
}

// The four `allowed` sets the handlers in src/app/api actually use.
const READ_ANYONE: Role[] = ["owner", "editor", "viewer", "public"];
const WRITE: Role[] = ["owner", "editor"];
const SIGNED_IN_READ: Role[] = ["owner", "editor", "viewer"];
const OWNER_ONLY: Role[] = ["owner"];

describe("requireRole", () => {
  it.each([
    ["owner", READ_ANYONE, "owner"],
    ["editor", READ_ANYONE, "editor"],
    ["viewer", READ_ANYONE, "viewer"],
    ["shareLink", READ_ANYONE, "public"],
    ["owner", WRITE, "owner"],
    ["editor", WRITE, "editor"],
    ["owner", SIGNED_IN_READ, "owner"],
    ["editor", SIGNED_IN_READ, "editor"],
    ["viewer", SIGNED_IN_READ, "viewer"],
    ["owner", OWNER_ONLY, "owner"],
  ] as const)("lets %s through %j as %s", async (caller, allowed, role) => {
    const guard = await guardFor(caller, [...allowed]);

    expect(isGuardResponse(guard)).toBe(false);
    expect(!isGuardResponse(guard) && guard.role).toBe(role);
  });

  it.each([
    ["viewer", WRITE, "a viewer can't write"],
    ["shareLink", WRITE, "a share link can't write"],
    ["anonymous", WRITE, "nobody can't write"],
    ["shareLink", SIGNED_IN_READ, "a share link has no personal layout to read"],
    ["anonymous", SIGNED_IN_READ, "nor does an anonymous caller"],
    ["editor", OWNER_ONLY, "an editor is not the owner"],
    ["viewer", OWNER_ONLY, "nor is a viewer"],
    ["shareLink", OWNER_ONLY, "nor is a share link"],
    ["anonymous", READ_ANYONE, "an anonymous caller with no token gets nothing"],
    ["stranger" as const, READ_ANYONE, "a signed-in stranger gets nothing"],
  ] as const)("answers 403 for %s against %j — %s", async (caller, allowed, why) => {
    const request = apiRequest(
      `/api/collections/${collectionId}/items`,
      caller === "stranger" ? { cookie: stranger.cookie } : callers()[caller],
    );

    const guard = await requireRole(request, collectionId, [...allowed]);

    // The reason rides along as the assertion message, so a failing row says
    // what was supposed to stop it rather than just "expected true".
    expect(isGuardResponse(guard), why).toBe(true);
    expect(isGuardResponse(guard) && guard.status).toBe(403);
    expect(isGuardResponse(guard) && (await guard.json())).toEqual({ error: "Not authorized." });
  });

  it("reads the share token off the query string", async () => {
    // `/s/:token` pages fetch with `?token=...`; nothing else carries it.
    const guard = await guardFor("shareLink", READ_ANYONE);

    expect(!isGuardResponse(guard) && guard.role).toBe("public");
  });

  it("refuses a share token while the link is switched off", async () => {
    await updateCollectionSettings(collectionId, { shareEnabled: false });

    expect(isGuardResponse(await guardFor("shareLink", READ_ANYONE))).toBe(true);
  });

  it("refuses a share token that isn't this collection's", async () => {
    const request = apiRequest(`/api/collections/${collectionId}/items`, { token: "tok_guessed" });

    expect(isGuardResponse(await requireRole(request, collectionId, READ_ANYONE))).toBe(true);
  });

  it("hands back the user id for a signed-in caller and null for a share link", async () => {
    // What view-prefs keys a personal layout on. A public caller has no id to
    // key one on, which is why that route's `allowed` list leaves them out.
    const signedIn = await guardFor("editor", READ_ANYONE);
    const shared = await guardFor("shareLink", READ_ANYONE);

    expect(!isGuardResponse(signedIn) && signedIn.userId).toBe(editor.id);
    expect(!isGuardResponse(shared) && shared.userId).toBeNull();
  });

  it("ignores a session cookie that isn't a session", async () => {
    // A forged or expired cookie has to read as anonymous rather than as an
    // error the route turns into a 500.
    const request = apiRequest(`/api/collections/${collectionId}/items`, {
      headers: { cookie: "better-auth.session_token=not-a-real-token.and-not-a-real-signature" },
    });

    const guard = await requireRole(request, collectionId, READ_ANYONE);

    expect(isGuardResponse(guard) && guard.status).toBe(403);
  });

  it("refuses a collection that doesn't exist, even for a signed-in caller", async () => {
    const request = apiRequest("/api/collections/x/items", { cookie: owner.cookie });

    const guard = await requireRole(request, "00000000-0000-0000-0000-000000000000", READ_ANYONE);

    // 403 rather than 404: whether a collection exists is not something an
    // unauthorized caller is told.
    expect(isGuardResponse(guard) && guard.status).toBe(403);
  });
});

describe("isGuardResponse", () => {
  it("tells a refusal apart from a granted role", async () => {
    // The type guard is what makes `if (isGuardResponse(guard)) return guard;`
    // safe in every handler — a false negative would leak a 403 body as if it
    // were a role.
    expect(isGuardResponse(NextResponse.json({ error: "Not authorized." }, { status: 403 }))).toBe(true);
    expect(isGuardResponse({ userId: owner.id, role: "owner" })).toBe(false);
  });
});
