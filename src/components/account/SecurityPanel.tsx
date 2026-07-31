"use client";

import { useActionState, useTransition } from "react";
import { Blueprint } from "@/components/ui/Blueprint";
import { changePasswordAction, signOutEverywhereAction, type ActionState } from "@/actions/account";

export function SecurityPanel() {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    changePasswordAction,
    undefined,
  );
  const [isSigningOut, startTransition] = useTransition();

  return (
    <Blueprint style={{ padding: 18, display: "grid", gap: 14, marginBottom: 26 }}>
      <form action={formAction} style={{ display: "grid", gap: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 14 }}>
          <div className="field">
            <label>Current password</label>
            <input className="input" type="password" name="currentPassword" placeholder="••••••••••" required />
          </div>
          <div className="field">
            <label>New password</label>
            <input className="input" type="password" name="newPassword" placeholder="••••••••••" required minLength={8} />
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button className="btn btn-secondary" type="submit" disabled={pending}>
            {pending ? "Updating…" : "Change password"}
          </button>
          {state?.ok && <span style={{ fontSize: 12, color: "var(--color-accent-700)" }}>Password updated.</span>}
          {state?.error && <span style={{ fontSize: 12, color: "#b5544a" }}>{state.error}</span>}
        </div>
      </form>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", fontSize: 13 }}>
        <span>Active sessions across your devices</span>
        <button
          className="btn btn-secondary"
          type="button"
          disabled={isSigningOut}
          onClick={() => startTransition(() => signOutEverywhereAction())}
        >
          {isSigningOut ? "Signing out…" : "Sign out everywhere"}
        </button>
      </div>
    </Blueprint>
  );
}
