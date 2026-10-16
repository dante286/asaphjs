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

// The transport is `sendEmail`'s own spec's business (send.test.ts drives a real
// nodemailer client). Here it's the seam the action calls, so a spec can say
// what was sent and make the send fail; the template stays real.
const mail = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@/lib/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email")>()),
  sendEmail: mail.send,
}));

const actions = await import("./members");

let owner: TestUser;
let editor: TestUser;
let collectionId: string;

beforeEach(async () => {
  nextCache.refresh.mockClear();
  mail.send.mockReset().mockResolvedValue("sent");
  owner = await createTestUser();
  editor = await createTestUser();
  const collection = await aCollection({ ownerId: owner.id });
  collectionId = collection.id;

  signedInAs(owner);
  const invite = await invited(editor.email, "editor");
  await signedInAsAndAccept(editor, invite.token);
  signedInAs(owner);
  mail.send.mockClear();
});

/** Invite as whoever is signed in, and expect an invite rather than `already_member`. */
async function invited(email: string, role: "viewer" | "editor") {
  const result = await actions.inviteMemberAction(collectionId, email, role);
  if (!result.ok) throw new Error(`expected an invite, got ${result.reason}`);
  return { ...result, token: result.inviteUrl.split("/invite/")[1] };
}

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
    const invite = await invited("  Guest@Example.TEST  ", "viewer");

    expect(invite).toMatchObject({ invitedEmail: "guest@example.test", role: "viewer" });
    expect(invite.token).toHaveLength(24);
  });

  it("refuses an editor", async () => {
    signedInAs(editor);

    // An editor may fill the shelf, not decide who else sees it.
    await expect(actions.inviteMemberAction(collectionId, "guest@asaph.test", "editor")).rejects.toThrow(
      "Only the owner can manage sharing.",
    );
    expect(await listMembers(collectionId)).toHaveLength(1);
    expect(mail.send).not.toHaveBeenCalled();
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

describe("inviteMemberAction: the email", () => {
  it("mails the invitee an absolute link, naming the inviter, collection, role and expiry", async () => {
    const invite = await invited("guest@asaph.test", "editor");

    // No Host header reaches this spec, so requestOrigin falls back to loopback.
    // What matters is that the link is absolute: it's pasted into a mail client.
    const url = `http://localhost:3000/invite/${invite.token}`;
    expect(invite).toMatchObject({ email: "sent", inviteUrl: url });
    expect(mail.send).toHaveBeenCalledOnce();
    const message = mail.send.mock.calls[0][0];
    const collection = await getCollectionById(collectionId);
    expect(message.to).toBe("guest@asaph.test");
    expect(message.subject).toBe(`${owner.name} shared ${collection!.name} with you`);
    expect(message.text).toContain(url);
    expect(message.text).toContain("view and edit");
    // The same window acceptInvite enforces.
    expect(message.text).toContain("expires in 14 days");
    expect(message.html).toContain(`href="${url}"`);
  });

  it("says so when the instance has no mail configured", async () => {
    mail.send.mockResolvedValue("not_configured");

    const invite = await invited("guest@asaph.test", "viewer");

    // The card tells the owner to copy the link — which is the truth.
    expect(invite.email).toBe("not_configured");
  });

  it("keeps a working invite when the send fails", async () => {
    mail.send.mockRejectedValue(new Error("535 5.7.3 Authentication unsuccessful"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const guest = await createTestUser();

    const invite = await invited(guest.email, "viewer");

    // Rolling the row back over an SMTP outage would throw away an invite that
    // works and make the owner start over. The owner hears "failed"; the
    // operator, who can fix it, gets the cause.
    expect(invite.email).toBe("failed");
    expect(logged.mock.calls[0]).toEqual([
      expect.stringContaining(guest.email),
      expect.objectContaining({ message: "535 5.7.3 Authentication unsuccessful" }),
    ]);
    await signedInAsAndAccept(guest, invite.token);
    expect(await resolveRole(collectionId, guest.id)).toBe("viewer");
    logged.mockRestore();
  });

  it("re-inviting a pending address mails a fresh link and kills the old one", async () => {
    const guest = await createTestUser();
    const first = await invited(guest.email, "viewer");

    const second = await invited(guest.email, "viewer");

    // That's resend: the upsert mints a new token, so the second email's link
    // is the only one that works.
    expect(second.token).not.toBe(first.token);
    expect(mail.send).toHaveBeenCalledTimes(2);
    expect(mail.send.mock.calls[1][0].text).toContain(second.inviteUrl);
    signedInAs(guest);
    await expect(actions.acceptInviteAction(first.token)).rejects.toThrow("Invite not found.");
    await signedInAsAndAccept(guest, second.token);
  });

  it("leaves an accepted member's access alone and sends nothing", async () => {
    const result = await actions.inviteMemberAction(collectionId, editor.email, "viewer");

    // Re-inviting used to clear acceptedAt, so typing a member's address in
    // again revoked their access — and with mail, would also have emailed them.
    expect(result).toEqual({ ok: false, reason: "already_member" });
    expect(mail.send).not.toHaveBeenCalled();
    expect(await resolveRole(collectionId, editor.id)).toBe("editor");
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
    const invite = await invited(guest.email, "viewer");
    signedInAs(guest);

    const error = await actions.acceptInviteAction(invite.token).catch((e: unknown) => e);

    const collection = await getCollectionById(collectionId);
    expect((error as { digest: string }).digest).toBe(
      `NEXT_REDIRECT;replace;/collections/${collection!.slug};307;`,
    );
    expect(await resolveRole(collectionId, guest.id)).toBe("viewer");
  });

  it("refuses an invite addressed to someone else", async () => {
    const guest = await createTestUser();
    const interloper = await createTestUser();
    const invite = await invited(guest.email, "viewer");
    signedInAs(interloper);

    // A leaked link must not admit whoever opens it — the address the owner
    // named is the whole authorization.
    await expect(actions.acceptInviteAction(invite.token)).rejects.toThrow(
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
    const invite = await invited(guest.email, "viewer");
    const { db } = await import("@/db/client");
    const { collectionMembers } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    await db
      .update(collectionMembers)
      .set({ invitedAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000) })
      .where(eq(collectionMembers.inviteToken, invite.token));
    signedInAs(guest);

    await expect(actions.acceptInviteAction(invite.token)).rejects.toThrow(
      "This invite has expired.",
    );
  });

  it("needs a session, since the invite is bound to an account", async () => {
    const guest = await createTestUser();
    const invite = await invited(guest.email, "viewer");
    signedOut();

    await expect(actions.acceptInviteAction(invite.token)).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_REDIRECT"),
    });
    expect(await resolveRole(collectionId, guest.id)).toBeNull();
  });
});
