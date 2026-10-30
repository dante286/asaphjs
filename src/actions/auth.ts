"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { APIError } from "better-auth/api";
import { findInviteByToken } from "@/db/queries/registration-invites";
import { auth } from "@/lib/auth/auth";
import { safeNext } from "@/lib/auth/safe-next";

export type AuthActionState = { error?: string } | undefined;

export async function signInAction(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  // Attacker-supplied: it arrives on the query string and rides through the
  // form as a hidden input. See `safeNext` for what that buys someone.
  const next = safeNext(String(formData.get("next") ?? "/"));

  try {
    await auth.api.signInEmail({ body: { email, password } });
  } catch (err) {
    if (err instanceof APIError) return { error: err.message };
    return { error: "Sign in failed. Please try again." };
  }

  redirect(next);
}

export async function signUpAction(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");
  const displayName = String(formData.get("displayName") ?? "");

  if (password !== confirmPassword) {
    return { error: "Passwords don't match." };
  }

  try {
    await auth.api.signUpEmail({ body: { email, password, name: displayName || email } });
  } catch (err) {
    if (err instanceof APIError) return { error: err.message };
    return { error: "Sign up failed. Please try again." };
  }

  redirect("/");
}

const INVITE_GONE =
  "This invitation has expired or was already used. Ask whoever invited you to send a new one.";

/**
 * Registers from a `/join/[token]` invitation. The email comes from the invite
 * row, never from the form, so through this page an invite can only ever make
 * the account it was sent to. The gate in `betterAuth()` checks the token again
 * on the way in; this lookup is only where the address comes from.
 */
export async function signUpWithInviteAction(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");
  const displayName = String(formData.get("displayName") ?? "");

  if (password !== confirmPassword) {
    return { error: "Passwords don't match." };
  }

  // Pending when the page loaded isn't pending now: it may have been revoked,
  // used from another tab, or run out while they typed.
  const invite = await findInviteByToken(token);
  if (!invite) return { error: INVITE_GONE };

  // Not a declared sign-up field, so it's passed as a variable rather than a
  // literal the body type would refuse. The gate reads it off the endpoint
  // context; `parseUserInput` drops it before anything is written.
  const body = { email: invite.email, password, name: displayName || invite.email, inviteToken: token };

  try {
    await auth.api.signUpEmail({ body });
  } catch (err) {
    // The same thing seen a moment later: the gate refusing a token that went
    // bad after the lookup above, or a double submit finding the account the
    // first one made.
    const code = authErrorCode(err);
    if (code === "EMAIL_PASSWORD_SIGN_UP_DISABLED" || code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL") {
      return { error: INVITE_GONE };
    }
    if (err instanceof APIError) return { error: err.message };
    return { error: "Sign up failed. Please try again." };
  }

  redirect("/");
}

/**
 * Better Auth's error code, whatever threw it. Not `instanceof APIError`: a body
 * that fails its schema (a malformed email, say) is rejected by the router with
 * a plain `Error` carrying `status` and `body.code: "VALIDATION_ERROR"`, which
 * that check doesn't match.
 */
function authErrorCode(err: unknown): string | undefined {
  return (err as { body?: { code?: unknown } } | null)?.body?.code as string | undefined;
}

export type ResetRequestState = { error?: string; sent?: boolean } | undefined;

/**
 * Asks Better Auth for a reset email. The answer is `{ sent: true }` whether or
 * not the address has an account, whether or not the per-address cooldown held
 * the email back, and whether or not the send worked: any difference between
 * those would turn this form into a way to find out who has an account here.
 * Better Auth already answers an unknown address with its success message and
 * simulates the lookup for timing; this just mustn't undo that on the way out.
 */
export async function requestPasswordResetAction(
  _prevState: ResetRequestState,
  formData: FormData,
): Promise<ResetRequestState> {
  const email = String(formData.get("email") ?? "").trim();

  try {
    await auth.api.requestPasswordReset({ body: { email } });
  } catch (err) {
    // The two refusals that come before any lookup, so neither says anything
    // about the address.
    const code = authErrorCode(err);
    if (code === "RESET_PASSWORD_DISABLED") {
      return { error: "Password reset isn't available on this instance. Ask whoever runs it." };
    }
    if (code === "VALIDATION_ERROR") return { error: "Enter a valid email address." };
    return { error: "Something went wrong. Please try again." };
  }

  return { sent: true };
}

/** Sets the new password from the emailed link, then sends them to sign in with it. */
export async function resetPasswordAction(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (password !== confirmPassword) {
    return { error: "Passwords don't match." };
  }

  try {
    await auth.api.resetPassword({ body: { newPassword: password, token } });
  } catch (err) {
    if (authErrorCode(err) === "INVALID_TOKEN") {
      return { error: "This link has expired or was already used. Ask for a new one from the sign-in page." };
    }
    // Too short, too long: Better Auth's message says which.
    if (err instanceof APIError) return { error: err.message };
    return { error: "Couldn't reset your password. Please try again." };
  }

  // Every session was just revoked, this device's included, so there's no
  // signing them straight in: they prove the new password once.
  redirect("/auth?reset=done");
}

export async function signOutAction() {
  await auth.api.signOut({ headers: await headers() });
  redirect("/auth");
}
