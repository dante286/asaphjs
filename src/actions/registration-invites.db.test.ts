import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { findInviteByToken, listPendingInvites } from "@/db/queries/registration-invites";
import { registrationInvites, user } from "@/db/schema";
import { createRegistrationInvite, createTestUser, type TestUser } from "@/test/db/fixtures";
import { signedInAs, signedOut } from "@/test/db/session";

/**
 * Sending registration invites (#116). The gate that redeems them is pinned in
 * `src/lib/auth/auth.db.test.ts`; this is everything that decides whether an
 * invite gets made and mailed: who can, to whom, how often, how many.
 *
 * Availability is read per call (`registrationInvitesAvailable`), so each spec
 * closes signups and configures mail with stubbed env rather than reloading
 * `auth.ts`. The fixtures still register users through Better Auth, whose gate
 * was loaded with signups open by the setup file.
 */

const mail = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@/lib/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email")>()),
  sendEmail: mail.send,
}));

/** A host the request claims, to show the link never uses one. */
const forged = vi.hoisted(() => ({ host: null as string | null }));
vi.mock("next/headers", async () => {
  const { sessionHeaders } = await import("@/test/db/session");
  return {
    headers: async () => {
      const headers = sessionHeaders();
      if (forged.host) {
        headers.set("host", forged.host);
        headers.set("x-forwarded-host", forged.host);
      }
      return headers;
    },
  };
});

const { inviteToRegisterAction, revokeRegistrationInviteAction } = await import("./registration-invites");

let me: TestUser;
let someoneElse: TestUser;

beforeEach(async () => {
  me = await createTestUser();
  someoneElse = await createTestUser();
  signedInAs(me);
  forged.host = null;
  mail.send.mockReset().mockResolvedValue("sent");

  vi.stubEnv("ALLOW_SIGNUPS", "false");
  vi.stubEnv("SMTP_HOST", "smtp.asaph.test");
  vi.stubEnv("EMAIL_FROM", "Asaph <asaph@asaph.test>");
  vi.stubEnv("BETTER_AUTH_URL", "https://asaph.example.com");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function row(email: string) {
  return db.query.registrationInvites.findFirst({ where: eq(registrationInvites.email, email) });
}

/** Moves an invite's `sent_at` back, which is how far the clock has moved for it. */
async function sentSecondsAgo(email: string, seconds: number) {
  await db
    .update(registrationInvites)
    .set({ sentAt: new Date(Date.now() - seconds * 1000) })
    .where(eq(registrationInvites.email, email));
}

/** Invite, and expect it to have been made. */
async function invited(email: string) {
  const result = await inviteToRegisterAction(email);
  if (!result.ok) throw new Error(`expected an invite to ${email}, got ${result.reason}`);
  return result.invite;
}

describe("inviteToRegisterAction", () => {
  it("emails a /join link on BETTER_AUTH_URL, whatever host the request claims", async () => {
    // The attack this is shaped around: invite someone with a forged host, and a
    // link built from the request would hand their registration token to it.
    forged.host = "evil.example";

    const invite = await invited("  Guest@Example.TEST ");

    expect(invite).toMatchObject({ email: "guest@example.test", notSent: false });
    const { token } = (await row("guest@example.test"))!;
    expect(mail.send).toHaveBeenCalledOnce();
    const message = mail.send.mock.calls[0][0];
    expect(message.to).toBe("guest@example.test");
    expect(message.text).toContain(`https://asaph.example.com/join/${token}`);
    expect(`${message.text}${message.html}`).not.toContain("evil.example");
  });

  it("puts it on the inviter's list, and only theirs", async () => {
    await invited("guest@asaph.test");

    expect(await listPendingInvites(me.id)).toEqual([expect.objectContaining({ email: "guest@asaph.test" })]);
    expect(await listPendingInvites(someoneElse.id)).toEqual([]);
  });

  it.each([
    ["signups are open", "ALLOW_SIGNUPS", "true"],
    ["mail isn't configured", "SMTP_HOST", ""],
    ["BETTER_AUTH_URL is unset", "BETTER_AUTH_URL", ""],
  ])("refuses when %s, whatever the page shows", async (_, name, value) => {
    // A Server Action is a public endpoint: hiding the card isn't the check.
    vi.stubEnv(name, value);

    expect(await inviteToRegisterAction("guest@asaph.test")).toEqual({ ok: false, reason: "unavailable" });
    expect(await row("guest@asaph.test")).toBeUndefined();
    expect(mail.send).not.toHaveBeenCalled();
  });

  it("refuses something that isn't an email address", async () => {
    expect(await inviteToRegisterAction("not-an-address")).toEqual({ ok: false, reason: "invalid_email" });
    expect(mail.send).not.toHaveBeenCalled();
  });

  it("refuses an address that already has an account", async () => {
    expect(await inviteToRegisterAction(someoneElse.email.toUpperCase())).toEqual({
      ok: false,
      reason: "has_account",
    });
    expect(mail.send).not.toHaveBeenCalled();
  });

  it("invites again an address whose account was since deleted", async () => {
    // Its used invite is spent, and would otherwise block the address forever.
    await createRegistrationInvite({ email: "returning@asaph.test", usedAt: new Date(), invitedBy: someoneElse.id });

    await expect(invited("returning@asaph.test")).resolves.toMatchObject({ notSent: false });
    expect(await row("returning@asaph.test")).toMatchObject({ invitedBy: me.id, usedAt: null });
  });

  it("refuses an address someone else has a pending invite for, and leaves their link working", async () => {
    const theirs = await createRegistrationInvite({ email: "popular@asaph.test", invitedBy: someoneElse.id });
    // Past the cooldown, so it's ownership refusing this and not the minute.
    await sentSecondsAgo("popular@asaph.test", 61);

    expect(await inviteToRegisterAction("popular@asaph.test")).toEqual({ ok: false, reason: "already_invited" });
    expect(await row("popular@asaph.test")).toMatchObject({ token: theirs.token, invitedBy: someoneElse.id });
    expect(mail.send).not.toHaveBeenCalled();
  });

  it.each<[string, () => Promise<unknown>]>([
    [
      "expired",
      () =>
        createRegistrationInvite({
          email: "popular@asaph.test",
          invitedBy: someoneElse.id,
          sentAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
        }),
    ],
    [
      "revoked",
      async () => {
        await createRegistrationInvite({ email: "popular@asaph.test", invitedBy: someoneElse.id });
        await db.update(registrationInvites).set({ token: null }).where(eq(registrationInvites.email, "popular@asaph.test"));
        await sentSecondsAgo("popular@asaph.test", 61);
      },
    ],
  ])("takes over someone else's %s invite", async (_, arrange) => {
    await arrange();

    await invited("popular@asaph.test");

    expect(await row("popular@asaph.test")).toMatchObject({ invitedBy: me.id, token: expect.any(String) });
    expect(mail.send).toHaveBeenCalledOnce();
  });
});

describe("the cap", () => {
  const five = ["a", "b", "c", "d", "e"].map((name) => `${name}@asaph.test`);

  it("stops a sixth pending invite", async () => {
    for (const email of five) await invited(email);

    expect(await inviteToRegisterAction("f@asaph.test")).toEqual({ ok: false, reason: "cap" });
    expect(mail.send).toHaveBeenCalledTimes(5);
  });

  it("lets you re-invite one already on your list", async () => {
    for (const email of five) await invited(email);
    await sentSecondsAgo("a@asaph.test", 61);

    await expect(invited("a@asaph.test")).resolves.toMatchObject({ email: "a@asaph.test" });
  });

  it("is per inviter", async () => {
    for (const email of five) await invited(email);
    signedInAs(someoneElse);

    await expect(invited("f@asaph.test")).resolves.toMatchObject({ email: "f@asaph.test" });
  });

  it("makes exactly one fifth out of two invites that arrive together", async () => {
    for (const email of five.slice(0, 4)) await invited(email);

    const results = await Promise.all([inviteToRegisterAction("x@asaph.test"), inviteToRegisterAction("y@asaph.test")]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, reason: "cap" }]);
    expect(await listPendingInvites(me.id)).toHaveLength(5);
  });

  it("stops counting an invite once it's used or expired", async () => {
    for (const email of five) await invited(email);
    await db.update(registrationInvites).set({ usedAt: new Date() }).where(eq(registrationInvites.email, "a@asaph.test"));
    await sentSecondsAgo("b@asaph.test", 15 * 24 * 60 * 60);

    await invited("f@asaph.test");
    await invited("g@asaph.test");
    expect(await listPendingInvites(me.id)).toHaveLength(5);
  });
});

describe("a send that fails", () => {
  beforeEach(() => {
    mail.send.mockRejectedValue(new Error("535 5.7.3 Authentication unsuccessful"));
  });

  it("keeps the invite as not sent, and logs why for the operator", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const invite = await invited("guest@asaph.test");

    expect(invite).toMatchObject({ email: "guest@asaph.test", notSent: true });
    expect((await row("guest@asaph.test"))?.sendFailedAt).toBeInstanceOf(Date);
    expect(logged).toHaveBeenCalledWith(
      expect.stringContaining("guest@asaph.test"),
      expect.objectContaining({ message: "535 5.7.3 Authentication unsuccessful" }),
    );
    logged.mockRestore();
  });

  it("still counts toward the cap", async () => {
    // The token never reached anyone, but it's still a pending invite until it's
    // resent or revoked.
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const name of ["a", "b", "c", "d", "e"]) await invited(`${name}@asaph.test`);

    expect(await inviteToRegisterAction("f@asaph.test")).toEqual({ ok: false, reason: "cap" });
    vi.mocked(console.error).mockRestore();
  });

  it("is cleared by a Resend that goes through", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await invited("guest@asaph.test");
    vi.mocked(console.error).mockRestore();
    mail.send.mockReset().mockResolvedValue("sent");
    await sentSecondsAgo("guest@asaph.test", 61);

    await expect(invited("guest@asaph.test")).resolves.toMatchObject({ notSent: false });
    expect((await row("guest@asaph.test"))?.sendFailedAt).toBeNull();
  });
});

describe("the resend cooldown", () => {
  it("holds a re-invite inside the minute, sends nothing, and keeps the link already sent", async () => {
    await invited("guest@asaph.test");
    const { token } = (await row("guest@asaph.test"))!;

    const again = await inviteToRegisterAction("guest@asaph.test");

    expect(again).toEqual({ ok: false, reason: "cooldown", secondsLeft: expect.any(Number) });
    expect((again as { secondsLeft: number }).secondsLeft).toBeGreaterThan(0);
    expect((again as { secondsLeft: number }).secondsLeft).toBeLessThanOrEqual(60);
    expect(mail.send).toHaveBeenCalledOnce();
    expect((await row("guest@asaph.test"))?.token).toBe(token);
  });

  it("sends again, with a fresh link, once the minute is up", async () => {
    await invited("guest@asaph.test");
    const { token } = (await row("guest@asaph.test"))!;
    await sentSecondsAgo("guest@asaph.test", 61);

    await invited("guest@asaph.test");

    expect(mail.send).toHaveBeenCalledTimes(2);
    const fresh = (await row("guest@asaph.test"))!.token!;
    expect(fresh).not.toBe(token);
    expect(await findInviteByToken(token!)).toBeUndefined();
  });

  it("sends exactly one of two re-invites that arrive together", async () => {
    // A double-clicked Resend sends one email, not two.
    await invited("guest@asaph.test");
    await sentSecondsAgo("guest@asaph.test", 61);
    mail.send.mockClear();

    await Promise.all([inviteToRegisterAction("guest@asaph.test"), inviteToRegisterAction("guest@asaph.test")]);

    expect(mail.send).toHaveBeenCalledOnce();
  });

  it("holds through a revoke, so revoke-then-invite is no way around it", async () => {
    await invited("guest@asaph.test");
    await revokeRegistrationInviteAction("guest@asaph.test");

    expect(await inviteToRegisterAction("guest@asaph.test")).toMatchObject({ ok: false, reason: "cooldown" });
    expect(mail.send).toHaveBeenCalledOnce();
  });
});

describe("revokeRegistrationInviteAction", () => {
  it("kills the link and takes the invite off the list and the cap", async () => {
    for (const name of ["a", "b", "c", "d", "e"]) await invited(`${name}@asaph.test`);
    const { token } = (await row("a@asaph.test"))!;

    expect(await revokeRegistrationInviteAction("A@asaph.test")).toEqual({ revoked: true });

    expect(await findInviteByToken(token!)).toBeUndefined();
    expect((await listPendingInvites(me.id)).map((i) => i.email)).not.toContain("a@asaph.test");
    await expect(invited("f@asaph.test")).resolves.toMatchObject({ email: "f@asaph.test" });
  });

  it("only touches your own invites", async () => {
    const theirs = await createRegistrationInvite({ email: "theirs@asaph.test", invitedBy: someoneElse.id });

    expect(await revokeRegistrationInviteAction("theirs@asaph.test")).toEqual({ revoked: false });
    expect((await row("theirs@asaph.test"))?.token).toBe(theirs.token);
  });
});

describe("signed out", () => {
  it("does neither", async () => {
    signedOut();

    await expect(inviteToRegisterAction("guest@asaph.test")).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_REDIRECT"),
    });
    await expect(revokeRegistrationInviteAction("guest@asaph.test")).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_REDIRECT"),
    });
    expect(await db.select().from(registrationInvites)).toEqual([]);
    expect(await db.select().from(user)).toHaveLength(2);
  });
});
