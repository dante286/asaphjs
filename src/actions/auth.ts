"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { APIError } from "better-auth/api";
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
