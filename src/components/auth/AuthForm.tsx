"use client";

import { useActionState, useState } from "react";
import { signInAction, signUpAction, type AuthActionState } from "@/actions/auth";
import { Blueprint } from "@/components/ui/Blueprint";
import { SegmentedControl } from "@/components/ui/SegmentedControl";

export function AuthForm({ next, allowSignups }: { next: string; allowSignups: boolean }) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
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
  // API rejects it too (`disableSignUp`); hiding it here is so a closed door
  // isn't something you discover by filling in a form and submitting it.
  const isSignUp = allowSignups && mode === "signup";
  const state = isSignUp ? signUpState : signInState;
  const pending = isSignUp ? signUpPending : signInPending;

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
          </div>
        </form>
      </div>
    </Blueprint>
  );
}
