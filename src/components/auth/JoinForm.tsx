"use client";

import { useActionState } from "react";
import { signUpWithInviteAction, type AuthActionState } from "@/actions/auth";
import { Blueprint } from "@/components/ui/Blueprint";

export function JoinForm({ token, email }: { token: string; email: string }) {
  const [state, formAction, pending] = useActionState<AuthActionState, FormData>(signUpWithInviteAction, undefined);

  return (
    <Blueprint
      className="elev-none"
      style={{ width: "100%", maxWidth: 420, padding: "clamp(20px,3vw,32px)", background: "var(--color-surface)" }}
    >
      <div style={{ fontSize: 15, fontWeight: 600 }}>You&rsquo;ve been invited to Asaph</div>
      <p style={{ fontSize: 12.5, marginTop: 8, color: "color-mix(in srgb, var(--color-text) 60%, transparent)" }}>
        Create your account to accept. The invitation works once, for this address.
      </p>
      <form action={formAction} style={{ display: "grid", gap: 14, marginTop: 16 }}>
        <input type="hidden" name="token" value={token} />
        <div className="field">
          <label htmlFor="join-email">Email</label>
          {/* No `name`: the action takes the address from the invite, never the form. */}
          <input id="join-email" className="input" type="email" value={email} readOnly aria-readonly="true" />
        </div>
        <div className="field">
          <label>Display name</label>
          <input className="input" type="text" name="displayName" placeholder="Optional" autoComplete="name" />
        </div>
        <div className="field">
          <label>Password</label>
          <input className="input" type="password" name="password" placeholder="••••••••••" required minLength={8} autoComplete="new-password" />
        </div>
        <div className="field">
          <label>Confirm password</label>
          <input className="input" type="password" name="confirmPassword" placeholder="••••••••••" required minLength={8} autoComplete="new-password" />
        </div>
        {state?.error && <div style={{ fontSize: 12.5, color: "#b5544a" }}>{state.error}</div>}
        <button className="btn btn-primary btn-block" type="submit" disabled={pending} style={{ height: 42 }}>
          {pending ? "Please wait…" : "Create account"}
        </button>
      </form>
    </Blueprint>
  );
}
