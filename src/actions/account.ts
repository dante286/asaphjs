"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { APIError } from "better-auth/api";
import { auth } from "@/lib/auth/auth";
import { emailVerificationAvailable, VERIFIED_CALLBACK_PATH } from "@/lib/auth/email-verification";
import { TOO_MANY_ATTEMPTS } from "@/lib/auth/rate-limit";
import { requireSession } from "@/lib/auth/session";
import { listCollectionsForUser } from "@/db/queries/collections";
import { listItems } from "@/db/queries/items";
import { getFieldValue } from "@/lib/fields/item-values";

export type ActionState = { error?: string; ok?: boolean } | undefined;

/** Where a successful password change lands; the account page reads the flag. Not exported: a "use server" module may export only async functions. */
const PASSWORD_CHANGED_PATH = "/account?password=changed";

export async function updateProfileAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireSession();
  const name = String(formData.get("displayName") ?? "").trim();
  const timeZone = String(formData.get("timeZone") ?? "UTC").trim();
  const currency = String(formData.get("currency") ?? "USD").trim();

  try {
    await auth.api.updateUser({
      headers: await headers(),
      body: { name, timeZone, currency },
    });
  } catch (err) {
    if (err instanceof APIError) return { error: err.message };
    return { error: "Couldn't update your profile." };
  }
  return { ok: true };
}

/**
 * Signs out every other device. A password change is often the answer to a
 * suspected compromise, and leaving the intruder's session alive would make it
 * pointless; password reset does the same. This device isn't signed out: Better
 * Auth replaces its session with a fresh one and the `nextCookies` plugin sets
 * that cookie from here.
 *
 * Success redirects rather than returning `{ ok }`. Returning re-renders the page
 * inside this same request, from the request's original headers, which still
 * carry the session token that was just revoked: the page's own session check
 * fails and bounces to /auth. A redirect is rendered as a fresh request with
 * the new cookie (sign-in relies on the same thing), and the page shows the
 * confirmation from `?password=changed`.
 */
export async function changePasswordAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireSession();
  const currentPassword = String(formData.get("currentPassword") ?? "");
  const newPassword = String(formData.get("newPassword") ?? "");

  try {
    await auth.api.changePassword({
      headers: await headers(),
      body: { currentPassword, newPassword, revokeOtherSessions: true },
    });
  } catch (err) {
    if (err instanceof APIError) return { error: err.message };
    return { error: "Couldn't change your password." };
  }
  // Outside the try: `redirect` works by throwing.
  redirect(PASSWORD_CHANGED_PATH);
}

/**
 * The password is the confirmation gate, and it's `auth.api.deleteUser`'s own:
 * without one the endpoint insists the session be fresher than `freshAge` (a day
 * by default), so a signed-in-since-last-week person would get
 * `SESSION_EXPIRED` from a button that looked ready. Asking for it every time
 * makes the gate the same one every time, and it's a better gate than typing a
 * word — a borrowed laptop with a live session can't get past it.
 *
 * The upload sweep hangs off `user.deleteUser.beforeDelete` in
 * `src/lib/auth/auth.ts`, not this action, so `/api/auth/delete-user` sweeps too
 * — the same reasoning as the registration gate living in a database hook.
 */
export async function deleteAccountAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireSession();
  const password = String(formData.get("password") ?? "");

  try {
    await auth.api.deleteUser({
      headers: await headers(),
      body: { password },
    });
  } catch (err) {
    if (err instanceof APIError) return { error: err.message };
    return { error: "Couldn't delete your account." };
  }

  // Outside the catch: `redirect` works by throwing. The session cookie is
  // already cleared by the endpoint (the `nextCookies` plugin lets it write one
  // from a Server Action), so this lands on the sign-in form rather than
  // bouncing through `requireSession`.
  redirect("/auth");
}

/**
 * Emails the signed-in account a verification link. The answer is the same
 * whether or not mail went out (the sender logs why it didn't), apart from a
 * hit limit, which is about this client rather than the account.
 */
export async function sendVerificationEmailAction(): Promise<ActionState> {
  const session = await requireSession();
  if (!emailVerificationAvailable()) return { error: "This instance can't send email, so there's nothing to verify." };

  try {
    await auth.api.sendVerificationEmail({
      body: { email: session.user.email, callbackURL: VERIFIED_CALLBACK_PATH },
      headers: await headers(),
    });
  } catch (err) {
    const code = (err as { body?: { code?: unknown } } | null)?.body?.code;
    // Verified in another tab since the page loaded: the job is done.
    if (code === "EMAIL_ALREADY_VERIFIED") return { ok: true };
    if (code === TOO_MANY_ATTEMPTS) return { error: (err as Error).message };
    return { error: "Couldn't send the email. Try again." };
  }
  return { ok: true };
}

/**
 * Every session, this device's included, so it ends on the sign-in form rather
 * than on a page that would fail at the next click.
 */
export async function signOutEverywhereAction() {
  await requireSession();
  await auth.api.revokeSessions({ headers: await headers() });
  redirect("/auth");
}

function toCsvValue(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function exportAllCsvAction() {
  const session = await requireSession();
  const collectionRows = await listCollectionsForUser(session.user.id);

  const parts: string[] = [];
  for (const { collection } of collectionRows) {
    const { rows } = await listItems({ collectionId: collection.id, pageSize: 10000 });
    const fields = collection.fields;
    parts.push(`# ${collection.name}`);
    parts.push(fields.map((f) => toCsvValue(f.label)).join(","));
    for (const item of rows) {
      const line = fields.map((field, index) => toCsvValue(getFieldValue(item, field, index)));
      parts.push(line.join(","));
    }
    parts.push("");
  }
  return parts.join("\n");
}

export async function exportAllJsonAction() {
  const session = await requireSession();
  const collectionRows = await listCollectionsForUser(session.user.id);

  const data = await Promise.all(
    collectionRows.map(async ({ collection }) => {
      const { rows } = await listItems({ collectionId: collection.id, pageSize: 10000 });
      return {
        name: collection.name,
        templateKey: collection.templateKey,
        fields: collection.fields,
        items: rows,
      };
    }),
  );
  return JSON.stringify(data, null, 2);
}
