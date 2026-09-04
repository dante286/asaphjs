import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCollectionById } from "@/db/queries/collections";
import { listMembers, resolveRole } from "@/db/queries/members";
import { aCollection, createTestUser, type TestUser } from "@/test/db/fixtures";
import { signedInAs, signedOut } from "@/test/db/session";

/**
 * A Server Action is a public POST endpoint whatever the UI renders, so what
 * matters most here is the guard: sharing is the owner's to manage, and an
 * editor with a browser console must not be able to invite anyone or rotate
 * the public link.
 *
 * `next/headers` is mocked because that is the only thing in an action that
 * needs a request scope. The cookie it hands over is real and Better Auth
 * validates it, so "not signed in" is the library's answer.
 */
vi.mock("next/headers", async () => {
  const { sessionHeaders } = await import("@/test/db/session");
  return { headers: async () => sessionHeaders() };
});

// `refresh()` throws outside a Server Action, and two of these call it: the
// page builds the share URL from the token the action mints, so without a
// re-render the owner sees a switched-on link and no address.
const nextCache = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/cache", () => nextCache);

const actions = await import("./members");

let owner: TestUser;
let editor: TestUser;
let collectionId: string;

beforeEach(async () => {
  nextCache.refresh.mockClear();
  owner = await createTestUser();
  editor = await createTestUser();
  const collection = await aCollection({ ownerId: owner.id });
  collectionId = collection.id;

  signedInAs(owner);
  const invite = await actions.inviteMemberAction(collectionId, editor.email, "editor");
  await signedInAsAndAccept(editor, invite.inviteToken!);
  signedInAs(owner);
});

async function signedInAsAndAccept(user: TestUser, token: string) {
  signedInAs(user);
  // The action redirects on success, which is how it lands the accepting user
  // on the collection they were given.
  await expect(actions.acceptInviteAction(token)).rejects.toMatchObject({
    digest: expect.stringContaining("NEXT_REDIRECT"),
  });
}

describe("inviteMemberAction", () => {
  it("stores a lowercased, trimmed address with a token", async () => {
    const member = await actions.inviteMemberAction(collectionId, "  Guest@Example.TEST  ", "viewer");

    expect(member).toMatchObject({ invitedEmail: "guest@example.test", role: "viewer" });
    expect(member.inviteToken).toHaveLength(24);
  });

  it("refuses an editor", async () => {
    signedInAs(editor);

    // An editor may fill the shelf, not decide who else sees it.
    await expect(actions.inviteMemberAction(collectionId, "guest@asaph.test", "editor")).rejects.toThrow(
      "Only the owner can manage sharing.",
    );
    expect(await listMembers(collectionId)).toHaveLength(1);
  });

  it("refuses a stranger", async () => {
    const stranger = await createTestUser();
    signedInAs(stranger);

    await expect(actions.inviteMemberAction(collectionId, "guest@asaph.test", "viewer")).rejects.toThrow(
      "Only the owner can manage sharing.",
    );
  });

  it("refuses a caller with no session", async () => {
    signedOut();

    await expect(actions.inviteMemberAction(collectionId, "guest@asaph.test", "viewer")).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_REDIRECT"),
    });
  });
});

describe("updateMemberRoleAction", () => {
  it("promotes a member without making them re-accept", async () => {
    await actions.updateMemberRoleAction(collectionId, editor.email, "viewer");

    expect(await resolveRole(collectionId, editor.id)).toBe("viewer");
  });

  it("refuses an editor changing their own role", async () => {
    signedInAs(editor);

    // The obvious privilege escalation, and the reason the guard is on the
    // action rather than on the button.
    await expect(actions.updateMemberRoleAction(collectionId, editor.email, "editor")).rejects.toThrow(
      "Only the owner can manage sharing.",
    );
  });
});

describe("removeMemberAction", () => {
  it("revokes access", async () => {
    await actions.removeMemberAction(collectionId, editor.email);

    expect(await resolveRole(collectionId, editor.id)).toBeNull();
    expect(await listMembers(collectionId)).toEqual([]);
  });

  it("refuses an editor removing the owner's other members", async () => {
    signedInAs(editor);

    await expect(actions.removeMemberAction(collectionId, editor.email)).rejects.toThrow(
      "Only the owner can manage sharing.",
    );
  });
});

describe("togglePublicLinkAction", () => {
  it("mints a token the first time it's switched on", async () => {
    await actions.togglePublicLinkAction(collectionId, true);

    const collection = await getCollectionById(collectionId);
    expect(collection).toMatchObject({ shareEnabled: true });
    expect(collection?.shareToken).toHaveLength(24);
    // Without a re-render the owner sees a switched-on link and no address.
    expect(nextCache.refresh).toHaveBeenCalledOnce();
  });

  it("keeps the same address when switched off and on again", async () => {
    await actions.togglePublicLinkAction(collectionId, true);
    const first = (await getCollectionById(collectionId))?.shareToken;

    await actions.togglePublicLinkAction(collectionId, false);
    await actions.togglePublicLinkAction(collectionId, true);

    // Switching off has to make the link dead without invalidating one already
    // handed out — turning it back on shouldn't break a bookmark.
    expect((await getCollectionById(collectionId))?.shareToken).toBe(first);
    expect(await resolveRole(collectionId, null, first)).toBe("public");
  });

  it("makes the token dead while it's off", async () => {
    await actions.togglePublicLinkAction(collectionId, true);
    const token = (await getCollectionById(collectionId))?.shareToken;

    await actions.togglePublicLinkAction(collectionId, false);

    expect(await resolveRole(collectionId, null, token)).toBeNull();
  });

  it("refuses an editor", async () => {
    signedInAs(editor);

    await expect(actions.togglePublicLinkAction(collectionId, true)).rejects.toThrow(
      "Only the owner can manage sharing.",
    );
    expect(await getCollectionById(collectionId)).toMatchObject({ shareEnabled: false });
  });
});

describe("rotateShareTokenAction", () => {
  it("replaces the address and kills the old one", async () => {
    await actions.togglePublicLinkAction(collectionId, true);
    const before = (await getCollectionById(collectionId))?.shareToken;

    await actions.rotateShareTokenAction(collectionId);

    const after = (await getCollectionById(collectionId))?.shareToken;
    expect(after).not.toBe(before);
    expect(after).toHaveLength(24);
    // What rotation is for: whoever had the old link no longer has access.
    expect(await resolveRole(collectionId, null, before)).toBeNull();
    expect(await resolveRole(collectionId, null, after)).toBe("public");
  });

  it("leaves sharing switched on", async () => {
    await actions.togglePublicLinkAction(collectionId, true);

    await actions.rotateShareTokenAction(collectionId);

    expect(await getCollectionById(collectionId)).toMatchObject({ shareEnabled: true });
    expect(nextCache.refresh).toHaveBeenCalledTimes(2);
  });

  it("refuses an editor", async () => {
    signedInAs(editor);

    await expect(actions.rotateShareTokenAction(collectionId)).rejects.toThrow(
      "Only the owner can manage sharing.",
    );
  });
});

describe("acceptInviteAction", () => {
  it("lands the accepting user on the collection they were given", async () => {
    const guest = await createTestUser();
    const invite = await actions.inviteMemberAction(collectionId, guest.email, "viewer");
    signedInAs(guest);

    const error = await actions.acceptInviteAction(invite.inviteToken!).catch((e: unknown) => e);

    const collection = await getCollectionById(collectionId);
    expect((error as { digest: string }).digest).toBe(
      `NEXT_REDIRECT;replace;/collections/${collection!.slug};307;`,
    );
    expect(await resolveRole(collectionId, guest.id)).toBe("viewer");
  });

  it("refuses an invite addressed to someone else", async () => {
    const guest = await createTestUser();
    const interloper = await createTestUser();
    const invite = await actions.inviteMemberAction(collectionId, guest.email, "viewer");
    signedInAs(interloper);

    // A leaked link must not admit whoever opens it — the address the owner
    // named is the whole authorization.
    await expect(actions.acceptInviteAction(invite.inviteToken!)).rejects.toThrow(
      "This invite was sent to a different email address.",
    );
    expect(await resolveRole(collectionId, interloper.id)).toBeNull();
  });

  it("reports an unknown token as not found", async () => {
    const guest = await createTestUser();
    signedInAs(guest);

    await expect(actions.acceptInviteAction("tok_nope")).rejects.toThrow("Invite not found.");
  });

  it("reports an expired invite as expired", async () => {
    const guest = await createTestUser();
    const invite = await actions.inviteMemberAction(collectionId, guest.email, "viewer");
    const { db } = await import("@/db/client");
    const { collectionMembers } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    await db
      .update(collectionMembers)
      .set({ invitedAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000) })
      .where(eq(collectionMembers.inviteToken, invite.inviteToken!));
    signedInAs(guest);

    await expect(actions.acceptInviteAction(invite.inviteToken!)).rejects.toThrow(
      "This invite has expired.",
    );
  });

  it("needs a session, since the invite is bound to an account", async () => {
    const guest = await createTestUser();
    const invite = await actions.inviteMemberAction(collectionId, guest.email, "viewer");
    signedOut();

    await expect(actions.acceptInviteAction(invite.inviteToken!)).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_REDIRECT"),
    });
    expect(await resolveRole(collectionId, guest.id)).toBeNull();
  });
});
