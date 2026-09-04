import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { collectionMembers } from "@/db/schema";
import { updateCollectionSettings } from "./collections";
import { acceptInvite, inviteMember, listMembers, removeMember, resolveRole, updateMemberRole } from "./members";
import { aCollection, createTestUser, type TestUser } from "@/test/db/fixtures";

/**
 * `resolveRole` is the authorization decision the whole app rests on: every
 * route handler and server action funnels through it, and its answer is the
 * difference between someone reading a shelf and someone editing it. It reads
 * three tables and a share token, so the only place it can be checked is
 * against real rows.
 */

let owner: TestUser;
let collectionId: string;

beforeEach(async () => {
  owner = await createTestUser();
  const collection = await aCollection({ ownerId: owner.id });
  collectionId = collection.id;
});

async function invite(email: string, role: "viewer" | "editor" = "viewer") {
  const row = await inviteMember({ collectionId, invitedEmail: email, role, invitedBy: owner.id });
  return row.inviteToken!;
}

async function enableSharing(token = "tok_public") {
  await updateCollectionSettings(collectionId, { shareToken: token, shareEnabled: true });
  return token;
}

describe("resolveRole", () => {
  it("gives the owner owner", async () => {
    expect(await resolveRole(collectionId, owner.id)).toBe("owner");
  });

  it("gives an accepted member the role they were invited with", async () => {
    const guest = await createTestUser();
    const token = await invite(guest.email, "editor");
    await acceptInvite(token, guest.id, guest.email);

    expect(await resolveRole(collectionId, guest.id)).toBe("editor");
  });

  it("gives an invited-but-not-accepted member nothing", async () => {
    const guest = await createTestUser();
    await invite(guest.email, "editor");

    // The membership row exists; `acceptedAt` is what makes it count.
    expect(await resolveRole(collectionId, guest.id)).toBeNull();
  });

  it("gives a signed-in stranger nothing", async () => {
    const stranger = await createTestUser();

    expect(await resolveRole(collectionId, stranger.id)).toBeNull();
  });

  it("gives an anonymous visitor with the share token public", async () => {
    const token = await enableSharing();

    expect(await resolveRole(collectionId, null, token)).toBe("public");
  });

  it("gives nothing for the right token while sharing is off", async () => {
    const token = await enableSharing();
    await updateCollectionSettings(collectionId, { shareEnabled: false });

    expect(await resolveRole(collectionId, null, token)).toBeNull();
  });

  it("gives nothing for a token that isn't this collection's", async () => {
    await enableSharing("tok_public");

    expect(await resolveRole(collectionId, null, "tok_guess")).toBeNull();
  });

  it("gives nothing to an anonymous visitor with no token", async () => {
    await enableSharing();

    expect(await resolveRole(collectionId, null)).toBeNull();
  });

  it("prefers a member's own role over the public one", async () => {
    // An editor who followed the public link is still an editor: membership is
    // checked before the token, so the read-only projection doesn't apply to
    // someone who may write.
    const guest = await createTestUser();
    const inviteToken = await invite(guest.email, "editor");
    await acceptInvite(inviteToken, guest.id, guest.email);
    const shareToken = await enableSharing();

    expect(await resolveRole(collectionId, guest.id, shareToken)).toBe("editor");
  });

  it("gives nothing for a collection that doesn't exist", async () => {
    expect(await resolveRole("00000000-0000-0000-0000-000000000000", owner.id)).toBeNull();
  });
});

describe("inviteMember", () => {
  it("stores the email lowercased with a token", async () => {
    const row = await inviteMember({
      collectionId,
      invitedEmail: "Guest@Example.TEST",
      role: "viewer",
      invitedBy: owner.id,
    });

    // Accepting compares emails case-insensitively, but storing one casing
    // keeps the unique index on (collection, email) meaningful.
    expect(row).toMatchObject({ invitedEmail: "guest@example.test", role: "viewer", acceptedAt: null });
    expect(row.inviteToken).toHaveLength(24);
  });

  it("re-inviting the same address replaces the invite rather than adding one", async () => {
    const guest = await createTestUser();
    const first = await invite(guest.email, "viewer");
    await acceptInvite(first, guest.id, guest.email);

    const reinvited = await inviteMember({
      collectionId,
      invitedEmail: guest.email,
      role: "editor",
      invitedBy: owner.id,
    });

    // A fresh token and acceptance cleared: re-inviting is how an owner
    // re-issues a link, so the old one has to stop working.
    expect(reinvited.role).toBe("editor");
    expect(reinvited.acceptedAt).toBeNull();
    expect(reinvited.inviteToken).not.toBe(first);
    expect(await listMembers(collectionId)).toHaveLength(1);
    expect(await resolveRole(collectionId, guest.id)).toBeNull();
  });
});

describe("acceptInvite", () => {
  it("binds the invite to the accepting user and burns the token", async () => {
    const guest = await createTestUser();
    const token = await invite(guest.email);

    expect(await acceptInvite(token, guest.id, guest.email)).toEqual({ ok: true, collectionId });

    const [member] = await listMembers(collectionId);
    expect(member).toMatchObject({ userName: guest.name });
    expect(member.acceptedAt).toBeInstanceOf(Date);
    // Single-use: the token is cleared, so a forwarded link is dead.
    expect(member.inviteToken).toBeNull();
  });

  it("accepts a differently-cased email", async () => {
    const guest = await createTestUser({ email: "guest-case@asaph.test" });
    const token = await invite("Guest-Case@asaph.test");

    expect(await acceptInvite(token, guest.id, "GUEST-CASE@ASAPH.TEST")).toMatchObject({ ok: true });
  });

  it("refuses someone else's invite", async () => {
    const guest = await createTestUser();
    const interloper = await createTestUser();
    const token = await invite(guest.email);

    // The address the owner named is the whole authorization: a leaked link
    // must not admit whoever opens it.
    expect(await acceptInvite(token, interloper.id, interloper.email)).toEqual({
      ok: false,
      reason: "email_mismatch",
    });
    expect(await resolveRole(collectionId, interloper.id)).toBeNull();
  });

  it("refuses an unknown token", async () => {
    const guest = await createTestUser();

    expect(await acceptInvite("tok_nope", guest.id, guest.email)).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("refuses an invite older than 14 days", async () => {
    const guest = await createTestUser();
    const token = await invite(guest.email);
    const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);
    await db
      .update(collectionMembers)
      .set({ invitedAt: fifteenDaysAgo })
      .where(eq(collectionMembers.inviteToken, token));

    expect(await acceptInvite(token, guest.id, guest.email)).toEqual({ ok: false, reason: "expired" });
  });

  it("refuses an invite with no timestamp at all", async () => {
    // `invited_at` is nullable, so a row can exist without one. Treating that
    // as epoch means the answer is "expired" rather than "fresh" — the safe
    // direction for something that grants access.
    const guest = await createTestUser();
    const token = await invite(guest.email);
    await db
      .update(collectionMembers)
      .set({ invitedAt: null })
      .where(eq(collectionMembers.inviteToken, token));

    expect(await acceptInvite(token, guest.id, guest.email)).toEqual({ ok: false, reason: "expired" });
  });

  it("accepts one that is a day short of expiring", async () =>{
    const guest = await createTestUser();
    const token = await invite(guest.email);
    await db
      .update(collectionMembers)
      .set({ invitedAt: new Date(Date.now() - 13 * 24 * 60 * 60 * 1000) })
      .where(eq(collectionMembers.inviteToken, token));

    expect(await acceptInvite(token, guest.id, guest.email)).toMatchObject({ ok: true });
  });
});

describe("listMembers", () => {
  it("names an accepted member and leaves a pending one unnamed", async () => {
    const guest = await createTestUser();
    const token = await invite(guest.email, "editor");
    await acceptInvite(token, guest.id, guest.email);
    await invite("pending@asaph.test", "viewer");

    const members = await listMembers(collectionId);

    // The left join is what allows a row for an address with no account yet —
    // an owner can invite someone who hasn't signed up.
    expect(members).toHaveLength(2);
    expect(members.find((m) => m.invitedEmail === guest.email)).toMatchObject({ userName: guest.name });
    expect(members.find((m) => m.invitedEmail === "pending@asaph.test")).toMatchObject({
      userName: null,
      role: "viewer",
    });
  });

  it("sees only this collection's members", async () => {
    const elsewhere = await aCollection({ ownerId: owner.id, name: "Elsewhere" });
    await inviteMember({
      collectionId: elsewhere.id,
      invitedEmail: "other@asaph.test",
      role: "viewer",
      invitedBy: owner.id,
    });
    await invite("mine@asaph.test");

    expect((await listMembers(collectionId)).map((m) => m.invitedEmail)).toEqual(["mine@asaph.test"]);
  });
});

describe("updateMemberRole and removeMember", () => {
  it("changes an accepted member's role without re-inviting them", async () => {
    const guest = await createTestUser();
    const token = await invite(guest.email, "viewer");
    await acceptInvite(token, guest.id, guest.email);

    await updateMemberRole(collectionId, guest.email, "editor");

    // Acceptance survives: promoting someone must not make them re-accept.
    expect(await resolveRole(collectionId, guest.id)).toBe("editor");
  });

  it("revokes access when the member is removed", async () => {
    const guest = await createTestUser();
    const token = await invite(guest.email, "editor");
    await acceptInvite(token, guest.id, guest.email);

    await removeMember(collectionId, guest.email);

    expect(await resolveRole(collectionId, guest.id)).toBeNull();
    expect(await listMembers(collectionId)).toEqual([]);
  });

  it("leaves the same address in another collection alone", async () => {
    const guest = await createTestUser();
    const elsewhere = await aCollection({ ownerId: owner.id, name: "Elsewhere" });
    const other = await inviteMember({
      collectionId: elsewhere.id,
      invitedEmail: guest.email,
      role: "editor",
      invitedBy: owner.id,
    });
    await acceptInvite(other.inviteToken!, guest.id, guest.email);
    await invite(guest.email);

    await removeMember(collectionId, guest.email);

    expect(await resolveRole(elsewhere.id, guest.id)).toBe("editor");
  });
});
