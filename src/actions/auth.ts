"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { APIError } from "better-auth/api";
import { auth } from "@/lib/auth/auth";

export type AuthActionState = { error?: string } | undefined;

export async function signInAction(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/");

  try {
    await auth.api.signInEmail({ body: { email, password } });
  } catch (err) {
    if (err instanceof APIError) return { error: err.message };
    return { error: "Sign in failed. Please try again." };
  }

  redirect(next || "/");
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

export async function signOutAction() {
  await auth.api.signOut({ headers: await headers() });
  redirect("/auth");
}
