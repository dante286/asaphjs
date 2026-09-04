import { existsSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/client";
import { createItem } from "@/db/queries/items";
import { aCollection, createTestUser, TEST_PASSWORD, writeTestUpload, type TestUser } from "@/test/db/fixtures";
import { signedInAs, signedOut } from "@/test/db/session";
import { UPLOADS_DIR } from "@/test/db/setup";

/**
 * The account actions are thin over Better Auth, and what they own is the part
 * that shows up in the UI: an `APIError` becomes a message a form can render
 * rather than a thrown stack. Worth testing because the failure mode is
 * silent — an unhandled throw here is a page that goes blank instead of
 * saying "that password was wrong".
 *
 * `deleteAccountAction` is the one with a behaviour of its own: the upload
 * sweep hangs off `user.deleteUser.beforeDelete`, so it has to run while the
 * rows a cascade is about to remove can still be read.
 */
vi.mock("next/headers", async () => {
  const { sessionHeaders } = await import("@/test/db/session");
  return { headers: async () => sessionHeaders() };
});

const actions = await import("./account");

let owner: TestUser;

beforeEach(async () => {
  owner = await createTestUser();
  signedInAs(owner);
});

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

describe("updateProfileAction", () => {
  it("saves the display name, time zone and currency", async () => {
    const result = await actions.updateProfileAction(
      undefined,
      form({ displayName: "  Renamed  ", timeZone: "America/Chicago", currency: "EUR" }),
    );

    expect(result).toEqual({ ok: true });
    expect(await db.query.user.findFirst()).toMatchObject({
      name: "Renamed",
      timeZone: "America/Chicago",
      currency: "EUR",
    });
  });

  it("defaults the fields a form left out", async () => {
    const result = await actions.updateProfileAction(undefined, form({ displayName: "Just a name" }));

    expect(result).toEqual({ ok: true });
    expect(await db.query.user.findFirst()).toMatchObject({ timeZone: "UTC", currency: "USD" });
  });

  it("needs a session", async () => {
    signedOut();

    await expect(
      actions.updateProfileAction(undefined, form({ displayName: "Nobody" })),
    ).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") });
  });
});

describe("changePasswordAction", () => {
  it("changes the password and leaves the session alone", async () => {
    const result = await actions.changePasswordAction(
      undefined,
      form({ currentPassword: TEST_PASSWORD, newPassword: "a-longer-new-password" }),
    );

    expect(result).toEqual({ ok: true });
    // `revokeOtherSessions: false`, so the person who just changed it isn't
    // signed out of the tab they did it in.
    const { auth } = await import("@/lib/auth/auth");
    await expect(
      auth.api.signInEmail({ body: { email: owner.email, password: "a-longer-new-password" } }),
    ).resolves.toMatchObject({ user: { email: owner.email } });
  });

  it("turns a wrong current password into a message rather than a throw", async () => {
    const result = await actions.changePasswordAction(
      undefined,
      form({ currentPassword: "not-the-password", newPassword: "a-longer-new-password" }),
    );

    // The form renders `error`; an unhandled APIError would blank the page.
    expect(result?.error).toBeTruthy();
    expect(result?.ok).toBeUndefined();
  });

  it("turns a too-short new password into a message", async () => {
    const result = await actions.changePasswordAction(
      undefined,
      form({ currentPassword: TEST_PASSWORD, newPassword: "short" }),
    );

    expect(result?.error).toBeTruthy();
  });
});

describe("signOutEverywhereAction", () => {
  it("removes every session row for the account", async () => {
    expect(await db.query.session.findMany()).not.toEqual([]);

    await actions.signOutEverywhereAction();

    expect(await db.query.session.findMany()).toEqual([]);
  });

  it("signs out a device presenting the session token", async () => {
    await actions.signOutEverywhereAction();

    // The token cookie alone, which is what a device has once the five-minute
    // `cookieCache` copy has expired. Presenting the cached `session_data`
    // cookie inside that window still reads as signed in — that's the trade
    // the cache is configured for in src/lib/auth/auth.ts, and the reason this
    // asserts on the token rather than on the whole cookie header.
    const token = owner.cookie.split("; ").find((c) => c.startsWith("better-auth.session_token="))!;
    const { auth } = await import("@/lib/auth/auth");

    expect(await auth.api.getSession({ headers: new Headers({ cookie: token }) })).toBeNull();
  });

  it("needs a session of its own", async () => {
    signedOut();

    await expect(actions.signOutEverywhereAction()).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_REDIRECT"),
    });
  });
});

describe("deleteAccountAction", () => {
  it("deletes the account and lands on the sign-in form", async () => {
    const error = await actions
      .deleteAccountAction(undefined, form({ password: TEST_PASSWORD }))
      .catch((e: unknown) => e);

    // Outside the catch in the action, because `redirect` works by throwing —
    // and the session cookie is already cleared by the endpoint, so this lands
    // on /auth rather than bouncing through requireSession.
    expect((error as { digest: string }).digest).toBe("NEXT_REDIRECT;replace;/auth;307;");
    expect(await db.query.user.findMany()).toEqual([]);
  });

  it("sweeps the uploads its collections were holding", async () => {
    // The reason the sweep is a `beforeDelete` hook: `collections.owner_id`
    // cascades from `user` and items cascade from collections, so by the time
    // the delete has happened nothing knows which files those rows named.
    const collection = await aCollection({ ownerId: owner.id });
    const coverUrl = await writeTestUpload("accountcover00000000.webp");
    await createItem({ collectionId: collection.id, title: "Chrono Trigger", coverUrl });

    await actions.deleteAccountAction(undefined, form({ password: TEST_PASSWORD })).catch(() => {});

    expect(existsSync(path.join(UPLOADS_DIR, "accountcover00000000.webp"))).toBe(false);
    expect(existsSync(path.join(UPLOADS_DIR, "accountcover00000000_t.webp"))).toBe(false);
  });

  it("keeps the account when the password is wrong", async () => {
    const result = await actions.deleteAccountAction(undefined, form({ password: "not-the-password" }));

    // The password is the gate, and it's Better Auth's own: without one the
    // endpoint insists the session be fresher than a day, so a
    // signed-in-since-last-week person would get SESSION_EXPIRED from a button
    // that looked ready.
    expect(result?.error).toBeTruthy();
    expect(await db.query.user.findMany()).toHaveLength(1);
  });

  it("keeps another owner's uploads", async () => {
    const other = await createTestUser();
    const theirs = await aCollection({ ownerId: other.id, name: "Theirs" });
    const theirCover = await writeTestUpload("theircover0000000000.webp");
    await createItem({ collectionId: theirs.id, title: "Theirs", coverUrl: theirCover });

    await actions.deleteAccountAction(undefined, form({ password: TEST_PASSWORD })).catch(() => {});

    expect(existsSync(path.join(UPLOADS_DIR, "theircover0000000000.webp"))).toBe(true);
  });
});
