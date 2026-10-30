import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { INVITE_TTL_DAYS } from "@/db/queries/members";
import { registrationInvites } from "@/db/schema";
import { createRegistrationInvite, createTestUser, TEST_PASSWORD } from "@/test/db/fixtures";

/**
 * `ALLOW_SIGNUPS=false` is the switch for running Asaph for one person or a
 * household on a URL anyone can reach, and it is enforced in exactly one place:
 * `databaseHooks.user.create.before` in `./auth`, which every way of creating a
 * user passes through. That covers both entry points at once — the Server
 * Actions call `auth.api.signUpEmail` rather than reimplementing the insert —
 * which is the property worth a test.
 *
 * `signupsAllowed()` is read once, when the module is evaluated, so this needs
 * a fresh module rather than a stubbed variable. The last test here is the one
 * that proves that's not paranoia.
 */

afterEach(async () => {
  vi.unstubAllEnvs();
  // `vi.resetModules()` leaves the pool from the re-imported client behind, and
  // this tier's whole claim about pools is that nothing leaks one.
  const { pool } = await import("@/db/client");
  await pool.end();
  vi.resetModules();
});

async function freshAuth() {
  vi.resetModules();
  return (await import("./auth")).auth;
}

function signUp(auth: Awaited<ReturnType<typeof freshAuth>>, email: string, inviteToken?: string) {
  // Not a declared field: the sign-up body schema passes extra keys through,
  // which is what will let the gate in #115 read it off the endpoint context.
  const extra = inviteToken === undefined ? {} : { inviteToken };
  return auth.api.signUpEmail({ body: { email, password: TEST_PASSWORD, name: "Whoever", ...extra } });
}

/** Better Auth's error code, or `undefined` if it didn't throw an APIError. */
async function refusalCode(attempt: Promise<unknown>): Promise<unknown> {
  const error = await attempt.then(
    () => undefined,
    (e: unknown) => e,
  );
  const { status, body } = (error ?? {}) as { status?: string; body?: { code?: string } };
  return status === undefined ? error : `${status} ${body?.code}`;
}

describe("registration", () => {
  it("is open by default", async () => {
    vi.stubEnv("ALLOW_SIGNUPS", undefined);
    const auth = await freshAuth();

    const { user } = await signUp(auth, "open@asaph.test");

    expect(user.email).toBe("open@asaph.test");
  });

  it("is closed when ALLOW_SIGNUPS is false", async () => {
    vi.stubEnv("ALLOW_SIGNUPS", "false");
    const auth = await freshAuth();

    const error = await signUp(auth, "closed@asaph.test").catch((e: unknown) => e);

    // 400 EMAIL_PASSWORD_SIGN_UP_DISABLED, which is what the sign-up form
    // shows and what `/api/auth/sign-up/email` answers with.
    expect(error).toMatchObject({ status: "BAD_REQUEST" });
    expect(String((error as { body?: { code?: string } }).body?.code)).toBe(
      "EMAIL_PASSWORD_SIGN_UP_DISABLED",
    );
  });

  it("writes no user when it refuses", async () => {
    vi.stubEnv("ALLOW_SIGNUPS", "false");
    const auth = await freshAuth();
    await signUp(auth, "closed@asaph.test").catch(() => {});

    const { db } = await import("@/db/client");
    expect(await db.query.user.findMany()).toEqual([]);
  });

  it("still lets an existing account sign in", async () => {
    // The point of the switch: it closes the door to new people, not to the
    // household already inside.
    vi.stubEnv("ALLOW_SIGNUPS", undefined);
    const open = await freshAuth();
    await signUp(open, "resident@asaph.test");

    vi.stubEnv("ALLOW_SIGNUPS", "false");
    const closed = await freshAuth();

    const { user } = await closed.api.signInEmail({
      body: { email: "resident@asaph.test", password: TEST_PASSWORD },
    });
    expect(user.email).toBe("resident@asaph.test");
  });

  it.each(["fasle", "no", "0", "off", "", "   ", "TRUE"])(
    "stays open for the near-miss %j",
    async (value) => {
      // Only the literal `false` closes the door — a typo leaving signups open
      // is recoverable, where a typo locking out an operator with no account
      // yet means editing env and redeploying to get back in.
      vi.stubEnv("ALLOW_SIGNUPS", value);
      const auth = await freshAuth();

      await expect(signUp(auth, `near-miss@asaph.test`)).resolves.toMatchObject({
        user: { email: "near-miss@asaph.test" },
      });
    },
  );

  it("is decided at module load, not per request", async () => {
    // Which is the whole reason the tests above re-import. Flipping the
    // variable on a running instance does nothing until it restarts — worth
    // pinning, because the alternative reading is that this switch is live.
    vi.stubEnv("ALLOW_SIGNUPS", undefined);
    const auth = await freshAuth();

    vi.stubEnv("ALLOW_SIGNUPS", "false");

    await expect(signUp(auth, "already-loaded@asaph.test")).resolves.toMatchObject({
      user: { email: "already-loaded@asaph.test" },
    });
  });
});

/**
 * The gate used to be `disableSignUp`, a Better Auth setting. It's now a
 * database hook that lets a pending invite's token through, which makes closure
 * app code, and these are the specs that keep a bug in it from opening the
 * instance (#114). The no-token and unknown-token cases passed against
 * `disableSignUp` too, which is the evidence the move didn't open anything.
 *
 * Every refusal is asserted by its exact code, not just "it threw" or its
 * status: a hook that returns `false` instead of throwing still keeps the door
 * shut, but answers 400 FAILED_TO_CREATE_USER, the same status with a code the
 * form and API clients don't expect.
 */
describe("registration with an invite token", () => {
  const EMAIL = "invited@asaph.test";
  const DAY = 24 * 60 * 60 * 1000;

  /** Each arranges the database and returns the token the sign-up for EMAIL carries. */
  const closedCases: [string, () => Promise<string | undefined>][] = [
    ["no token", async () => undefined],
    ["an unknown token", async () => "not-a-token-anyone-was-sent"],
    [
      "an expired token",
      async () =>
        (await createRegistrationInvite({ email: EMAIL, sentAt: new Date(Date.now() - INVITE_TTL_DAYS * DAY - 60_000) }))
          .token,
    ],
    [
      // An address with no account, so it's `used_at` that refuses this and not
      // the unique email: the account it made may since have been deleted.
      "a used token",
      async () => (await createRegistrationInvite({ email: EMAIL, usedAt: new Date() })).token,
    ],
    [
      "a revoked token",
      async () => {
        const { token } = await createRegistrationInvite({ email: EMAIL });
        const { db } = await import("@/db/client");
        await db.update(registrationInvites).set({ token: null }).where(eq(registrationInvites.email, EMAIL));
        return token;
      },
    ],
    [
      "another address's token",
      async () => (await createRegistrationInvite({ email: "someone-else@asaph.test" })).token,
    ],
  ];

  it.each(closedCases)("is refused with %s while signups are closed", async (_, arrange) => {
    vi.stubEnv("ALLOW_SIGNUPS", "false");
    const auth = await freshAuth();
    const token = await arrange();

    expect(await refusalCode(signUp(auth, EMAIL, token))).toBe("BAD_REQUEST EMAIL_PASSWORD_SIGN_UP_DISABLED");

    const { db } = await import("@/db/client");
    expect(await db.query.user.findMany()).toEqual([]);
  });

  it("lets the invited address register while signups are closed, and uses the invite", async () => {
    vi.stubEnv("ALLOW_SIGNUPS", "false");
    const auth = await freshAuth();
    const { token } = await createRegistrationInvite({ email: EMAIL });

    // Mixed case, as an API client might send it: Better Auth lowercases
    // `user.email` before the gate compares it with the invite's.
    const { user } = await signUp(auth, "Invited@Asaph.test", token);

    expect(user.email).toBe(EMAIL);
    const { db } = await import("@/db/client");
    const invite = await db.query.registrationInvites.findFirst({ where: eq(registrationInvites.email, EMAIL) });
    expect(invite?.usedAt).toBeInstanceOf(Date);
  });

  it("lets one invite make one account", async () => {
    vi.stubEnv("ALLOW_SIGNUPS", "false");
    const auth = await freshAuth();
    const { token } = await createRegistrationInvite({ email: EMAIL });
    await signUp(auth, EMAIL, token);

    // Refused as closed, by `used_at`, before Better Auth's lookup could say
    // the account exists. The unique email is still what single use rests on.
    expect(await refusalCode(signUp(auth, EMAIL, token))).toBe("BAD_REQUEST EMAIL_PASSWORD_SIGN_UP_DISABLED");

    const { db } = await import("@/db/client");
    expect(await db.query.user.findMany()).toHaveLength(1);
  });

  it("answers an address with an account the same as one without, while signups are closed", async () => {
    // Without the early check in `hooks.before`, Better Auth's lookup answers
    // USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL for the first, which would make a
    // closed sign-up a way to find out who has an account here.
    const { email } = await createTestUser();
    vi.stubEnv("ALLOW_SIGNUPS", "false");
    const auth = await freshAuth();

    expect(await refusalCode(signUp(auth, email))).toBe("BAD_REQUEST EMAIL_PASSWORD_SIGN_UP_DISABLED");
    expect(await refusalCode(signUp(auth, "nobody-here@asaph.test"))).toBe(
      "BAD_REQUEST EMAIL_PASSWORD_SIGN_UP_DISABLED",
    );
  });

  it("answers the same over HTTP", async () => {
    const { email } = await createTestUser();
    vi.stubEnv("ALLOW_SIGNUPS", "false");
    const auth = await freshAuth();

    const response = await auth.handler(
      new Request("http://localhost:3000/api/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify({ email, password: TEST_PASSWORD, name: "Whoever" }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "EMAIL_PASSWORD_SIGN_UP_DISABLED" });
  });

  it("refuses a user created outside a request while signups are closed", async () => {
    // No endpoint context means no body to carry a token, so nothing can vouch
    // for this one. Nothing creates users this way today (the demo seed inserts
    // with Drizzle and never reaches the hooks), so this is a decision pinned,
    // not a caller protected.
    vi.stubEnv("ALLOW_SIGNUPS", "false");
    const auth = await freshAuth();
    const { internalAdapter } = await auth.$context;

    expect(await refusalCode(internalAdapter.createUser({ email: EMAIL, name: "Nobody's guest" }, { method: "admin" }))).toBe(
      "BAD_REQUEST EMAIL_PASSWORD_SIGN_UP_DISABLED",
    );
  });

  it("doesn't need one while signups are open", async () => {
    vi.stubEnv("ALLOW_SIGNUPS", undefined);
    const auth = await freshAuth();

    await expect(signUp(auth, "walk-in@asaph.test")).resolves.toMatchObject({
      user: { email: "walk-in@asaph.test" },
    });
  });

  it("is ignored while signups are open, and never written to the user row", async () => {
    vi.stubEnv("ALLOW_SIGNUPS", undefined);
    const auth = await freshAuth();
    const token = "a-token-nobody-asked-for";

    const { user } = await signUp(auth, "walk-in@asaph.test", token);

    // The raw row rather than `db.query.user`, which only reads the columns the
    // schema declares: this is the check that nothing grew one to hold it.
    const { pool } = await import("@/db/client");
    const { rows } = await pool.query(`select * from "user"`);
    expect(rows).toHaveLength(1);
    expect(Object.values(rows[0])).not.toContain(token);
    expect(Object.values(user)).not.toContain(token);
  });
});

describe("password reset", () => {
  function resetCode(auth: Awaited<ReturnType<typeof freshAuth>>) {
    return auth.api
      .requestPasswordReset({ body: { email: "anyone@asaph.test" } })
      .then(() => "offered")
      .catch((e: { body?: { code?: string } }) => e.body?.code);
  }

  function mailConfigured() {
    vi.stubEnv("SMTP_HOST", "smtp.asaph.test");
    vi.stubEnv("EMAIL_FROM", "asaph@asaph.test");
  }

  it("is off without mail", async () => {
    vi.stubEnv("BETTER_AUTH_URL", "https://asaph.example.com");
    const auth = await freshAuth();

    expect(await resetCode(auth)).toBe("RESET_PASSWORD_DISABLED");
  });

  it("is off with mail but no BETTER_AUTH_URL to build the link from", async () => {
    // Not a fallback to the request's host: that's the header a forger picks.
    mailConfigured();
    vi.stubEnv("BETTER_AUTH_URL", undefined);
    const auth = await freshAuth();

    expect(await resetCode(auth)).toBe("RESET_PASSWORD_DISABLED");
  });

  it("is on with both", async () => {
    // An address with no account, so this proves the endpoint answers without
    // anything being sent.
    mailConfigured();
    vi.stubEnv("BETTER_AUTH_URL", "https://asaph.example.com");
    const auth = await freshAuth();

    expect(await resetCode(auth)).toBe("offered");
  });
});
