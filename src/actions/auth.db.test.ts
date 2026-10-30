import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, like } from "drizzle-orm";
import { db, pool } from "@/db/client";
import { INVITE_TTL_DAYS } from "@/db/queries/members";
import { registrationInvites, verification } from "@/db/schema";
import { createRegistrationInvite, createTestUser, TEST_PASSWORD, type TestUser } from "@/test/db/fixtures";
import { signedInAs, signedOut } from "@/test/db/session";

/**
 * The three actions behind `/auth`, and the last module in `src/actions/` that
 * had no spec of its own. The gap was easy to miss because the flows *look*
 * covered from two directions at once: `auth.db.test.ts` exercises
 * `auth.api.signUpEmail` through the library, and the smoke tier signs up a
 * throwaway account in every spec's preamble. Neither one reaches sign-in or
 * sign-out, and neither one touches the part these actions actually own.
 *
 * What they own is the same thing the account actions own — an `APIError`
 * becoming a message a form can render rather than a thrown stack — plus two
 * decisions Better Auth never sees: the confirm-password comparison, which
 * happens before the library is called at all, and where a successful sign-in
 * lands.
 *
 * `redirect` works by throwing, so every success here is a rejection whose
 * `digest` carries the target. That is also what makes the failure cases worth
 * asserting on: a returned `{ error }` and a thrown redirect are the two
 * outcomes the form distinguishes, and getting them backwards is a page that
 * goes blank instead of saying what was wrong.
 *
 * Registration being closed (`ALLOW_SIGNUPS=false`) is tested here as well as
 * in `src/lib/auth/auth.db.test.ts`, though the action doesn't enforce it. While
 * the gate was `disableSignUp`, a library setting, pinning it once covered both
 * entry points. #115 makes it a database hook that lets an invite token through,
 * and the invite action reads the email from a row and passes the token on, so
 * the action is now a path into app code that can be wrong on its own (#114).
 */
/**
 * Password reset is wired into `betterAuth()` only when mail and
 * `BETTER_AUTH_URL` are both set, and that's decided when `auth.ts` is first
 * evaluated, so they're set here before anything imports it. The setup file
 * blanks SMTP for every other spec; the transport itself is mocked at the
 * `sendEmail` seam, so nothing leaves the process.
 */
const previousAuthUrl = vi.hoisted(() => {
  const previous = process.env.BETTER_AUTH_URL;
  process.env.SMTP_HOST = "smtp.asaph.test";
  process.env.EMAIL_FROM = "Asaph <asaph@asaph.test>";
  process.env.BETTER_AUTH_URL = "https://asaph.example.com";
  return previous;
});

afterAll(() => {
  process.env.BETTER_AUTH_URL = previousAuthUrl;
});

const mail = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@/lib/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email")>()),
  sendEmail: mail.send,
}));

/** A host the request claims, to show the reset link never uses one. */
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

const actions = await import("./auth");

let owner: TestUser;

beforeEach(async () => {
  owner = await createTestUser();
  signedOut();
  forged.host = null;
  mail.send.mockReset().mockResolvedValue("sent");
});

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

/** The thrown `redirect`, or a failure if the action returned instead. */
async function redirectFrom(action: Promise<unknown>): Promise<string> {
  const outcome = await action.then(
    (returned) => ({ returned }),
    (thrown: unknown) => ({ thrown }),
  );

  if (!("thrown" in outcome)) {
    throw new Error(`expected a redirect, got ${JSON.stringify(outcome.returned)}`);
  }
  return (outcome.thrown as { digest: string }).digest;
}

describe("signInAction", () => {
  it("opens a session and lands where the middleware was aiming", async () => {
    const digest = await redirectFrom(
      actions.signInAction(undefined, form({ email: owner.email, password: TEST_PASSWORD, next: "/account" })),
    );

    expect(digest).toBe("NEXT_REDIRECT;replace;/account;307;");
    // The session row, not just the redirect: `nextCookies()` writes the cookie
    // through a request scope this tier doesn't have, so the row is the only
    // evidence here that a credential was actually issued rather than the
    // action simply falling through to its redirect.
    expect(await db.query.session.findMany()).toHaveLength(2);
  });

  it("falls back to the dashboard when there was nowhere to go back to", async () => {
    // Someone who opened /auth directly rather than being bounced there, so the
    // form submits `next` as "". The common path, not the odd one.
    const digest = await redirectFrom(
      actions.signInAction(undefined, form({ email: owner.email, password: TEST_PASSWORD })),
    );

    expect(digest).toBe("NEXT_REDIRECT;replace;/;307;");
  });

  it("will not be talked into landing on another origin", async () => {
    // `safeNext` has its own unit tests for the spellings; this is the one that
    // proves it is actually in the path, on the far side of a real successful
    // sign-in. That combination is the whole point of the bug — the redirect
    // fires when the person has just proven they trust this page.
    for (const elsewhere of ["https://elsewhere.example/login", "//elsewhere.example", "/\\elsewhere.example"]) {
      const digest = await redirectFrom(
        actions.signInAction(
          undefined,
          form({ email: owner.email, password: TEST_PASSWORD, next: elsewhere }),
        ),
      );

      expect(digest).toBe("NEXT_REDIRECT;replace;/;307;");
    }
  });

  it("turns a wrong password into a message rather than a throw", async () => {
    const result = await actions.signInAction(
      undefined,
      form({ email: owner.email, password: "not-the-password" }),
    );

    expect(result?.error).toBeTruthy();
    expect(await db.query.session.findMany()).toHaveLength(1);
  });

  it("says the same thing about an unknown account as about a wrong password", async () => {
    // Not incidental: two different messages here would turn the sign-in form
    // into an oracle for which email addresses have accounts on the instance.
    // Better Auth collapses both into one INVALID_EMAIL_OR_PASSWORD, and the
    // action passes `err.message` straight through — so this stays true only as
    // long as nobody starts special-casing the error on the way out.
    const wrongPassword = await actions.signInAction(
      undefined,
      form({ email: owner.email, password: "not-the-password" }),
    );
    const noSuchAccount = await actions.signInAction(
      undefined,
      form({ email: "nobody-here@asaph.test", password: TEST_PASSWORD }),
    );

    expect(noSuchAccount?.error).toBe(wrongPassword?.error);
  });
});

describe("signUpAction", () => {
  it("registers the account and lands on the dashboard", async () => {
    const digest = await redirectFrom(
      actions.signUpAction(
        undefined,
        form({
          email: "new-arrival@asaph.test",
          password: "a-long-enough-password",
          confirmPassword: "a-long-enough-password",
          displayName: "New Arrival",
        }),
      ),
    );

    expect(digest).toBe("NEXT_REDIRECT;replace;/;307;");
    expect(await db.query.user.findFirst({ where: (u, { eq }) => eq(u.email, "new-arrival@asaph.test") }))
      .toMatchObject({ name: "New Arrival" });
  });

  it("catches a confirm-password mismatch before writing anything", async () => {
    const result = await actions.signUpAction(
      undefined,
      form({
        email: "mistyped@asaph.test",
        password: "a-long-enough-password",
        confirmPassword: "a-long-enough-passwrod",
        displayName: "Mistyped",
      }),
    );

    // The one check that is the action's alone — Better Auth is never sent a
    // `confirmPassword`, so if this comparison went missing the second field
    // would silently stop meaning anything and the first typo would become the
    // account's password.
    expect(result).toEqual({ error: "Passwords don't match." });
    expect(await db.query.user.findMany()).toHaveLength(1);
  });

  it("uses the email as the display name when the field was left blank", async () => {
    await actions
      .signUpAction(
        undefined,
        form({
          email: "anonymous@asaph.test",
          password: "a-long-enough-password",
          confirmPassword: "a-long-enough-password",
          displayName: "",
        }),
      )
      .catch(() => {});

    // `name` is not null in the schema, so the fallback is what keeps a blank
    // optional field from failing the insert.
    expect(await db.query.user.findFirst({ where: (u, { eq }) => eq(u.email, "anonymous@asaph.test") }))
      .toMatchObject({ name: "anonymous@asaph.test" });
  });

  it("turns a too-short password into a message", async () => {
    const result = await actions.signUpAction(
      undefined,
      form({
        email: "brief@asaph.test",
        password: "short",
        confirmPassword: "short",
        displayName: "Brief",
      }),
    );

    // `minPasswordLength: 8` lives in the Better Auth config, so this is the
    // APIError path rather than the action's own check.
    expect(result?.error).toBeTruthy();
    expect(await db.query.user.findMany()).toHaveLength(1);
  });
});

/**
 * A copy of these actions loaded with ALLOW_SIGNUPS=false, fresh for each test.
 * `auth.ts` reads it once, at evaluation, so stubbing the variable isn't enough.
 * The db client is pinned to the one already loaded: a fresh one would be a
 * second pool, and the setup file, importing it after the reset, a third that
 * nothing closes.
 */
function withSignupsClosed(): () => typeof actions {
  let closed: typeof actions;

  beforeEach(async () => {
    const client = await import("@/db/client");
    vi.doMock("@/db/client", () => client);
    vi.stubEnv("ALLOW_SIGNUPS", "false");
    vi.resetModules();
    closed = await import("./auth");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock("@/db/client");
    vi.resetModules();
  });

  return () => closed;
}

const DAY = 24 * 60 * 60 * 1000;

describe("signUpAction with an invite token", () => {
  function signUpForm(email: string, inviteToken?: string) {
    return form({
      email,
      password: "a-long-enough-password",
      confirmPassword: "a-long-enough-password",
      displayName: "Whoever",
      ...(inviteToken === undefined ? {} : { inviteToken }),
    });
  }

  describe("while signups are closed", () => {
    const closed = withSignupsClosed();

    it.each<[string, () => Promise<string | undefined>]>([
      ["no token", async () => undefined],
      ["an unknown token", async () => "not-a-token-anyone-was-sent"],
      // The general form never forwards a token: the way in is /join, where the
      // address comes from the invite rather than from whoever is typing.
      ["a valid invite's token", async () => (await createRegistrationInvite({ email: "uninvited@asaph.test" })).token],
    ])("refuses %s, with the message for closed registration", async (_, arrange) => {
      const token = await arrange();
      const result = await closed().signUpAction(undefined, signUpForm("uninvited@asaph.test", token));

      // EMAIL_PASSWORD_SIGN_UP_DISABLED's own message, passed through. A hook
      // that returns `false` rather than throwing would keep the door shut but
      // answer "Failed to create user", which this tells apart.
      expect(result).toEqual({ error: "Email and password sign up is not enabled" });
      expect(await db.query.user.findMany()).toEqual([expect.objectContaining({ id: owner.id })]);
    });

    it("says the same for an address that already has an account", async () => {
      // Anything else ("User already exists") would make this form a way to
      // find out who has an account here, and a Server Action never meets
      // Better Auth's rate limiter.
      const result = await closed().signUpAction(undefined, signUpForm(owner.email));

      expect(result).toEqual({ error: "Email and password sign up is not enabled" });
    });
  });

  it("ignores one while signups are open, and never writes it to the user row", async () => {
    const token = "a-token-nobody-asked-for";

    await expect(redirectFrom(actions.signUpAction(undefined, signUpForm("walk-in@asaph.test", token))))
      .resolves.toBe("NEXT_REDIRECT;replace;/;307;");

    const { rows } = await pool.query(`select * from "user" where email = 'walk-in@asaph.test'`);
    expect(rows).toHaveLength(1);
    expect(Object.values(rows[0])).not.toContain(token);
  });
});

describe("signUpWithInviteAction", () => {
  const closed = withSignupsClosed();
  const INVITE_GONE = "This invitation has expired or was already used. Ask whoever invited you to send a new one.";
  const EMAIL = "invited@asaph.test";

  function joinForm(token: string, over: Record<string, string> = {}) {
    return form({
      token,
      password: "a-long-enough-password",
      confirmPassword: "a-long-enough-password",
      displayName: "Invitee",
      ...over,
    });
  }

  function invite() {
    return db.query.registrationInvites.findFirst({ where: eq(registrationInvites.email, EMAIL) });
  }

  async function accountsFor(email: string) {
    return db.query.user.findMany({ where: (u, { eq }) => eq(u.email, email) });
  }

  it("registers the invited address, whatever email the form posts, and uses the invite", async () => {
    const { token } = await createRegistrationInvite({ email: EMAIL, invitedBy: owner.id });

    const digest = await redirectFrom(
      closed().signUpWithInviteAction(undefined, joinForm(token, { email: "someone-else@asaph.test" })),
    );

    expect(digest).toBe("NEXT_REDIRECT;replace;/;307;");
    expect(await accountsFor(EMAIL)).toEqual([expect.objectContaining({ name: "Invitee" })]);
    expect(await accountsFor("someone-else@asaph.test")).toEqual([]);
    expect((await invite())?.usedAt).toBeInstanceOf(Date);
  });

  it.each<[string, () => Promise<string>]>([
    ["no token", async () => ""],
    ["an unknown token", async () => "not-a-token-anyone-was-sent"],
    [
      "an expired token",
      async () =>
        (await createRegistrationInvite({ email: EMAIL, sentAt: new Date(Date.now() - INVITE_TTL_DAYS * DAY - 60_000) }))
          .token,
    ],
    ["a used token", async () => (await createRegistrationInvite({ email: EMAIL, usedAt: new Date() })).token],
  ])("says so, rather than throwing, for %s", async (_, arrange) => {
    const token = await arrange();

    expect(await closed().signUpWithInviteAction(undefined, joinForm(token))).toEqual({ error: INVITE_GONE });
    expect(await db.query.user.findMany()).toEqual([expect.objectContaining({ id: owner.id })]);
  });

  it("says so for an invite revoked after the page loaded", async () => {
    const { token } = await createRegistrationInvite({ email: EMAIL });
    // The page showed the form; then the inviter withdrew it.
    await db.update(registrationInvites).set({ token: null }).where(eq(registrationInvites.email, EMAIL));

    expect(await closed().signUpWithInviteAction(undefined, joinForm(token))).toEqual({ error: INVITE_GONE });
    expect(await accountsFor(EMAIL)).toEqual([]);
  });

  it("says so for a second submit, and makes one account", async () => {
    const { token } = await createRegistrationInvite({ email: EMAIL });
    await closed().signUpWithInviteAction(undefined, joinForm(token)).catch(() => {});

    expect(await closed().signUpWithInviteAction(undefined, joinForm(token))).toEqual({ error: INVITE_GONE });
    expect(await accountsFor(EMAIL)).toHaveLength(1);
  });

  it("doesn't use the invite when the sign-up fails", async () => {
    const { token } = await createRegistrationInvite({ email: EMAIL });

    const result = await closed().signUpWithInviteAction(
      undefined,
      joinForm(token, { password: "short", confirmPassword: "short" }),
    );

    expect(result).toMatchObject({ error: expect.stringMatching(/short/i) });
    expect((await invite())?.usedAt).toBeNull();
    await expect(redirectFrom(closed().signUpWithInviteAction(undefined, joinForm(token)))).resolves.toBe(
      "NEXT_REDIRECT;replace;/;307;",
    );
  });
});

describe("signOutAction", () => {
  it("revokes the session and lands on the sign-in form", async () => {
    signedInAs(owner);

    const digest = await redirectFrom(actions.signOutAction());

    expect(digest).toBe("NEXT_REDIRECT;replace;/auth;307;");
    expect(await db.query.session.findMany()).toEqual([]);
  });

  it("leaves the signed-out device unable to use the token it kept", async () => {
    signedInAs(owner);

    await actions.signOutAction().catch(() => {});

    // The token cookie on its own, for the same reason signOutEverywhereAction's
    // spec does it that way: the five-minute `cookieCache` copy still reads as a
    // session inside its window, so presenting the whole cookie header would
    // pass here whether or not anything was actually revoked.
    const token = owner.cookie.split("; ").find((c) => c.startsWith("better-auth.session_token="))!;
    const { auth } = await import("@/lib/auth/auth");

    expect(await auth.api.getSession({ headers: new Headers({ cookie: token }) })).toBeNull();
  });

  it("still sends a caller with no session to the sign-in form", async () => {
    // No `requireSession` in front of this one, so a double submit — or a click
    // after the session expired — reaches `auth.api.signOut` with nothing to
    // revoke. It has to land on /auth rather than throw a blank page at someone
    // whose only mistake was pressing the button twice.
    const digest = await redirectFrom(actions.signOutAction());

    expect(digest).toBe("NEXT_REDIRECT;replace;/auth;307;");
  });
});

/** The token from the most recent reset email. */
function lastResetToken(): string {
  const text: string = mail.send.mock.calls.at(-1)![0].text;
  const link = text.split("\n").find((line) => line.startsWith("https://"))!;
  return new URL(link).searchParams.get("token")!;
}

function requestReset(email: string) {
  return actions.requestPasswordResetAction(undefined, form({ email }));
}

function resetRows() {
  return db.select().from(verification).where(like(verification.identifier, "reset-password:%"));
}

describe("requestPasswordResetAction", () => {
  it("mails a link to the reset page on BETTER_AUTH_URL, whatever host the request claims", async () => {
    // The attack this is shaped around: ask for someone else's reset with a
    // forged host, and a link built from the request would carry their live
    // token to the forger's domain.
    forged.host = "evil.example";

    expect(await requestReset(owner.email)).toEqual({ sent: true });

    expect(mail.send).toHaveBeenCalledOnce();
    const message = mail.send.mock.calls[0][0];
    expect(message.to).toBe(owner.email);
    expect(message.text).toContain(`https://asaph.example.com/auth/reset?token=${lastResetToken()}`);
    expect(message.text).toContain("expires in 60 minutes");
    expect(`${message.text}${message.html}`).not.toContain("evil.example");
  });

  it("answers an unknown address exactly as it answers a real one, and sends nothing", async () => {
    // Any difference would make this form a way to list who has an account.
    const known = await requestReset(owner.email);
    const unknown = await requestReset("nobody-here@asaph.test");

    expect(unknown).toEqual(known);
    expect(mail.send).toHaveBeenCalledOnce();
  });

  it("sends one email a minute per address, and says the same thing when it holds one back", async () => {
    // Better Auth's own limiter only sees HTTP requests to /api/auth/*; a Server
    // Action calls auth.api directly and never meets it. Without this, a loop
    // could send an address unlimited mail on the operator's quota.
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const first = await requestReset(owner.email);
    const second = await requestReset(owner.email);
    const third = await requestReset(owner.email);

    expect([second, third]).toEqual([first, first]);
    expect(mail.send).toHaveBeenCalledOnce();
    // The held-back requests don't leave live tokens nobody was sent behind.
    expect(await resetRows()).toHaveLength(1);
    log.mockRestore();
  });

  it("sends again once the minute is up", async () => {
    await requestReset(owner.email);
    await db
      .update(verification)
      .set({ createdAt: new Date(Date.now() - 61_000) })
      .where(like(verification.identifier, "reset-password:%"));

    await requestReset(owner.email);

    expect(mail.send).toHaveBeenCalledTimes(2);
  });

  it("sends exactly one of two requests that arrive together", async () => {
    // A double-clicked button sends one email, not two. In one process the two
    // calls don't truly overlap, so this can't show they agree on which one
    // sends; src/db/queries/password-reset.db.test.ts pins that at the row level.
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await Promise.all([requestReset(owner.email), requestReset(owner.email)]);

    expect(mail.send).toHaveBeenCalledOnce();
    log.mockRestore();
  });

  it("holds Better Auth's own HTTP route to the same cooldown", async () => {
    // The check lives in sendResetPassword, which both entry points call, so
    // /api/auth/request-password-reset is no way around it.
    const { auth } = await import("@/lib/auth/auth");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await requestReset(owner.email);
    const response = await auth.handler(
      new Request("https://asaph.example.com/api/auth/request-password-reset", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://asaph.example.com" },
        body: JSON.stringify({ email: owner.email }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mail.send).toHaveBeenCalledOnce();
    log.mockRestore();
  });

  it("answers the same when the send fails, and logs why for the operator", async () => {
    mail.send.mockRejectedValue(new Error("535 5.7.3 Authentication unsuccessful"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await requestReset(owner.email)).toEqual({ sent: true });

    expect(logged).toHaveBeenCalledWith(
      expect.stringContaining(owner.email),
      expect.objectContaining({ message: "535 5.7.3 Authentication unsuccessful" }),
    );
    logged.mockRestore();
  });

  it("refuses something that isn't an email address", async () => {
    expect(await requestReset("not-an-address")).toEqual({ error: "Enter a valid email address." });
    expect(mail.send).not.toHaveBeenCalled();
  });
});

describe("resetPasswordAction", () => {
  const NEW_PASSWORD = "a-brand-new-password";

  function reset(token: string, password = NEW_PASSWORD, confirmPassword = password) {
    return actions.resetPasswordAction(undefined, form({ token, password, confirmPassword }));
  }

  it("sets the new password and sends them to sign in with it", async () => {
    await requestReset(owner.email);

    const digest = await redirectFrom(reset(lastResetToken()));

    expect(digest).toBe("NEXT_REDIRECT;replace;/auth?reset=done;307;");
    const { auth } = await import("@/lib/auth/auth");
    await expect(auth.api.signInEmail({ body: { email: owner.email, password: NEW_PASSWORD } })).resolves.toBeTruthy();
    await expect(auth.api.signInEmail({ body: { email: owner.email, password: TEST_PASSWORD } })).rejects.toThrow();
  });

  it("signs out every session the account had", async () => {
    // Often the reason for a reset is that someone else is signed in.
    await requestReset(owner.email);
    expect(await db.query.session.findMany()).toHaveLength(1);

    await reset(lastResetToken()).catch(() => {});

    expect(await db.query.session.findMany()).toEqual([]);
  });

  it("works once", async () => {
    await requestReset(owner.email);
    const token = lastResetToken();
    await reset(token).catch(() => {});

    expect(await reset(token, "yet-another-password")).toEqual({
      error: "This link has expired or was already used. Ask for a new one from the sign-in page.",
    });
  });

  it("passes on Better Auth's word about a too-short password, and keeps the token", async () => {
    await requestReset(owner.email);
    const token = lastResetToken();

    expect(await reset(token, "short")).toMatchObject({ error: expect.stringMatching(/short/i) });
    await expect(redirectFrom(reset(token))).resolves.toContain("/auth?reset=done");
  });

  it("refuses a token that was never issued", async () => {
    expect(await reset("not-a-real-token-at-all")).toMatchObject({ error: expect.stringContaining("expired") });
  });

  it("catches a mismatched confirmation without spending the token", async () => {
    await requestReset(owner.email);
    const token = lastResetToken();

    expect(await reset(token, NEW_PASSWORD, "a-brand-new-passwrod")).toEqual({ error: "Passwords don't match." });

    // Still live: a typo shouldn't cost them the email.
    expect(
      await db.select().from(verification).where(eq(verification.identifier, `reset-password:${token}`)),
    ).toHaveLength(1);
  });
});
