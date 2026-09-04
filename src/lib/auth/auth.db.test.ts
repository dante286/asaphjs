import { afterEach, describe, expect, it, vi } from "vitest";
import { TEST_PASSWORD } from "@/test/db/fixtures";

/**
 * `ALLOW_SIGNUPS=false` is the switch for running Asaph for one person or a
 * household on a URL anyone can reach, and it is enforced in exactly one place:
 * `betterAuth({ emailAndPassword: { disableSignUp: !signupsAllowed() } })`.
 * That covers both entry points at once — the Server Action calls
 * `auth.api.signUpEmail` rather than reimplementing the insert — which is the
 * property worth a test.
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

function signUp(auth: Awaited<ReturnType<typeof freshAuth>>, email: string) {
  return auth.api.signUpEmail({ body: { email, password: TEST_PASSWORD, name: "Whoever" } });
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
