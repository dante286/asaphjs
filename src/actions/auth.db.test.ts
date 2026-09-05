import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/client";
import { createTestUser, TEST_PASSWORD, type TestUser } from "@/test/db/fixtures";
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
 * Registration being closed (`ALLOW_SIGNUPS=false`) is deliberately not
 * retested here — it is enforced in `betterAuth()` rather than in the action,
 * which is the property `src/lib/auth/auth.db.test.ts` already pins.
 */
vi.mock("next/headers", async () => {
  const { sessionHeaders } = await import("@/test/db/session");
  return { headers: async () => sessionHeaders() };
});

const actions = await import("./auth");

let owner: TestUser;

beforeEach(async () => {
  owner = await createTestUser();
  signedOut();
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
