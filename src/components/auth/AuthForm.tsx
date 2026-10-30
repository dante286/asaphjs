"use client";

import { useActionState, useState } from "react";
import {
  requestPasswordResetAction,
  signInAction,
  signUpAction,
  type AuthActionState,
  type ResetRequestState,
} from "@/actions/auth";
import { Blueprint } from "@/components/ui/Blueprint";
import { SegmentedControl } from "@/components/ui/SegmentedControl";

export function AuthForm({
  next,
  allowSignups,
  allowReset,
  passwordWasReset,
}: {
  next: string;
  allowSignups: boolean;
  /** Mail and BETTER_AUTH_URL are both set; see `passwordResetAvailable`. */
  allowReset: boolean;
  /** Landed here from `/auth/reset` after setting a new password. */
  passwordWasReset: boolean;
}) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [forgot, setForgot] = useState(false);
  const [resetState, resetFormAction, resetPending] = useActionState<
    ResetRequestState,
    FormData
  >(requestPasswordResetAction, undefined);
  const [signInState, signInFormAction, signInPending] = useActionState<
    AuthActionState,
    FormData
  >(signInAction, undefined);
  const [signUpState, signUpFormAction, signUpPending] = useActionState<
    AuthActionState,
    FormData
  >(signUpAction, undefined);

  // With registration closed the sign-up half of the form is never reachable —
  // no segment to switch on it, and `mode` can't be anything but "signin". The
  // API rejects it too (the gate in `betterAuth()`); hiding it here is so a closed door
  // isn't something you discover by filling in a form and submitting it.
  const isSignUp = allowSignups && mode === "signup";
  const state = isSignUp ? signUpState : signInState;
  const pending = isSignUp ? signUpPending : signInPending;

  // Same rule as sign-up: with reset unavailable the link isn't offered, so
  // there's no form to fill in only to be told it can't work.
  if (allowReset && forgot) {
    return (
      <Blueprint
        className="elev-none"
        style={{ padding: "clamp(20px,3vw,32px)", background: "var(--color-surface)" }}
      >
        <div style={{ fontSize: 15, fontWeight: 600 }}>Reset your password</div>
        {resetState?.sent ? (
          // Identical for every address, including ones with no account here.
          <p style={{ fontSize: 13.5, marginTop: 16 }} role="status">
            If that address has an account, a link to reset its password is on its way. It
            expires in an hour.
          </p>
        ) : (
          <form action={resetFormAction} style={{ display: "grid", gap: 14, marginTop: 20 }}>
            <div className="field">
              <label>Email</label>
              <input className="input" type="email" name="email" placeholder="you@domain.net" required />
            </div>
            {resetState?.error && <div style={{ fontSize: 12.5, color: "#b5544a" }}>{resetState.error}</div>}
            <button className="btn btn-primary btn-block" type="submit" disabled={resetPending} style={{ height: 42 }}>
              {resetPending ? "Please wait…" : "Send reset link"}
            </button>
          </form>
        )}
        <button className="btn btn-ghost" type="button" style={{ marginTop: 12, fontSize: 12.5 }} onClick={() => setForgot(false)}>
          Back to sign in
        </button>
      </Blueprint>
    );
  }

  return (
    <Blueprint
      className="elev-none"
      style={{ padding: "clamp(20px,3vw,32px)", background: "var(--color-surface)" }}
    >
      {allowSignups ? (
        <SegmentedControl
          name="authmode"
          value={mode}
          onChange={setMode}
          options={[
            { value: "signin", label: "Sign in" },
            { value: "signup", label: "Create account" },
          ]}
        />
      ) : (
        <div style={{ fontSize: 15, fontWeight: 600 }}>Sign in</div>
      )}
      {passwordWasReset && !isSignUp && (
        <div role="status" style={{ marginTop: 16, fontSize: 12.5, color: "var(--color-accent-700)" }}>
          Password changed, and every device signed out. Sign in with the new one.
        </div>
      )}
      <div style={{ marginTop: 20 }}>
        <form action={isSignUp ? signUpFormAction : signInFormAction} style={{ display: "grid", gap: 14 }}>
          <input type="hidden" name="next" value={next} />
          {isSignUp && (
            <div className="field">
              <label>Display name</label>
              <input className="input" type="text" name="displayName" placeholder="Matt N." />
            </div>
          )}
          <div className="field">
            <label>Email</label>
            <input className="input" type="email" name="email" placeholder="you@domain.net" required />
          </div>
          <div className="field">
            <label>Password</label>
            <input className="input" type="password" name="password" placeholder="••••••••••" required minLength={8} />
          </div>
          {isSignUp && (
            <div className="field">
              <label>Confirm password</label>
              <input className="input" type="password" name="confirmPassword" placeholder="••••••••••" required minLength={8} />
            </div>
          )}
          {state?.error && (
            <div style={{ fontSize: 12.5, color: "#b5544a" }}>{state.error}</div>
          )}
          <button className="btn btn-primary btn-block" type="submit" disabled={pending} style={{ height: 42 }}>
            {pending ? "Please wait…" : isSignUp ? "Create account" : "Sign in"}
          </button>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              fontSize: 12,
              color: "color-mix(in srgb, var(--color-text) 55%, transparent)",
            }}
          >
            <label style={{ display: "inline-flex", alignItems: "center", gap: 7, cursor: "pointer" }}>
              <input type="checkbox" defaultChecked style={{ accentColor: "var(--color-accent)" }} />
              Keep me signed in
            </label>
            {allowReset && !isSignUp && (
              <button
                type="button"
                className="btn btn-ghost"
                style={{ fontSize: 12, padding: 0, height: "auto" }}
                onClick={() => setForgot(true)}
              >
                Forgot password?
              </button>
            )}
          </div>
        </form>
      </div>
    </Blueprint>
  );
}
