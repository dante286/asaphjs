"use client";

import { useActionState } from "react";
import { Blueprint } from "@/components/ui/Blueprint";
import { updateProfileAction, type ActionState } from "@/actions/account";

export function ProfileForm({
  displayName,
  email,
  timeZone,
  currency,
}: {
  displayName: string;
  email: string;
  timeZone: string;
  currency: string;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    updateProfileAction,
    undefined,
  );

  return (
    <form action={formAction}>
      <Blueprint
        style={{
          padding: 18,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))",
          gap: 14,
          marginBottom: 12,
        }}
      >
        <div className="field">
          <label>Display name</label>
          <input className="input" type="text" name="displayName" defaultValue={displayName} />
        </div>
        <div className="field">
          <label>Email</label>
          <input className="input" type="email" defaultValue={email} disabled />
        </div>
        <div className="field">
          <label>Time zone</label>
          <input className="input" type="text" name="timeZone" defaultValue={timeZone} />
        </div>
        <div className="field">
          <label>Currency</label>
          <input className="input" type="text" name="currency" defaultValue={currency} />
        </div>
      </Blueprint>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 26 }}>
        <button className="btn btn-secondary" type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save profile"}
        </button>
        {state?.ok && <span style={{ fontSize: 12, color: "var(--color-accent-700)" }}>Saved.</span>}
        {state?.error && <span style={{ fontSize: 12, color: "#b5544a" }}>{state.error}</span>}
      </div>
    </form>
  );
}
