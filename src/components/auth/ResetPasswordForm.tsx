"use client";

import { useActionState } from "react";
import { resetPasswordAction, type AuthActionState } from "@/actions/auth";
import { Blueprint } from "@/components/ui/Blueprint";

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState<AuthActionState, FormData>(resetPasswordAction, undefined);

  return (
    <Blueprint
      className="elev-none"
      style={{ width: "100%", maxWidth: 420, padding: "clamp(20px,3vw,32px)", background: "var(--color-surface)" }}
    >
      <div style={{ fontSize: 15, fontWeight: 600 }}>Choose a new password</div>
      <p style={{ fontSize: 12.5, marginTop: 8, color: "color-mix(in srgb, var(--color-text) 60%, transparent)" }}>
        Setting it signs out every device, this one included.
      </p>
      <form action={formAction} style={{ display: "grid", gap: 14, marginTop: 16 }}>
        <input type="hidden" name="token" value={token} />
        <div className="field">
          <label>New password</label>
          <input className="input" type="password" name="password" placeholder="••••••••••" required minLength={8} autoComplete="new-password" />
        </div>
        <div className="field">
          <label>Confirm new password</label>
          <input className="input" type="password" name="confirmPassword" placeholder="••••••••••" required minLength={8} autoComplete="new-password" />
        </div>
        {state?.error && <div style={{ fontSize: 12.5, color: "#b5544a" }}>{state.error}</div>}
        <button className="btn btn-primary btn-block" type="submit" disabled={pending} style={{ height: 42 }}>
          {pending ? "Please wait…" : "Set new password"}
        </button>
      </form>
    </Blueprint>
  );
}
