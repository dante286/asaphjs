"use client";

import { useActionState, useState, useTransition } from "react";
import { Blueprint } from "@/components/ui/Blueprint";
import { Dialog } from "@/components/ui/Dialog";
import {
  changePasswordAction,
  deleteAccountAction,
  signOutEverywhereAction,
  type ActionState,
} from "@/actions/account";

export function SecurityPanel({
  collectionCount,
  itemCount,
}: {
  collectionCount: number;
  itemCount: number;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    changePasswordAction,
    undefined,
  );
  const [isSigningOut, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteState, deleteFormAction, deleting] = useActionState<ActionState, FormData>(
    deleteAccountAction,
    undefined,
  );

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
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          fontSize: 12.5,
          borderTop: "1px solid var(--color-divider)",
          paddingTop: 12,
        }}
      >
        <span style={{ color: "color-mix(in srgb, var(--color-text) 60%, transparent)" }}>
          Deleting your account removes your collections, their items and photos, and everyone
          else&apos;s access to them.
        </span>
        <button
          className="btn btn-ghost"
          style={{ fontSize: 12, color: "#b5544a" }}
          type="button"
          onClick={() => setConfirmOpen(true)}
        >
          Delete account
        </button>
      </div>

      {confirmOpen && (
        <Dialog
          open
          onClose={() => {
            if (!deleting) setConfirmOpen(false);
          }}
          title="Delete your account?"
          actions={
            <>
              <button
                className="btn btn-ghost"
                type="button"
                disabled={deleting}
                onClick={() => setConfirmOpen(false)}
              >
                Cancel
              </button>
              {/* Submits the form in the body — the dialog puts its actions in a
                  sibling of the body, and `form=` is what reaches across that. */}
              <button className="btn btn-primary" type="submit" form="delete-account" disabled={deleting}>
                {deleting ? "Deleting…" : "Delete forever"}
              </button>
            </>
          }
        >
          <form id="delete-account" action={deleteFormAction} style={{ display: "grid", gap: 12 }}>
            <p style={{ margin: 0 }}>
              This removes {collectionCount} collection{collectionCount === 1 ? "" : "s"},{" "}
              {itemCount} item{itemCount === 1 ? "" : "s"} and every photo uploaded to them, plus
              your sign-in and everyone else&apos;s access to what you shared. It can&apos;t be
              undone.
            </p>
            <p style={{ margin: 0, fontSize: 12.5, color: "color-mix(in srgb, var(--color-text) 60%, transparent)" }}>
              Want a copy first? Export{" "}
              <a href="/api/account/export/csv" style={{ color: "var(--color-accent-700)" }}>
                CSV
              </a>{" "}
              or{" "}
              <a href="/api/account/export/json" style={{ color: "var(--color-accent-700)" }}>
                JSON
              </a>{" "}
              — the download leaves this dialog open.
            </p>
            <div className="field" style={{ gap: 4 }}>
              <label htmlFor="delete-account-password">Enter your password to confirm</label>
              <input
                id="delete-account-password"
                className="input"
                type="password"
                name="password"
                autoComplete="current-password"
                placeholder="••••••••••"
                required
                autoFocus
                disabled={deleting}
              />
            </div>
            {deleteState?.error && (
              <span style={{ fontSize: 12, color: "#b5544a" }}>{deleteState.error}</span>
            )}
          </form>
        </Dialog>
      )}
    </Blueprint>
  );
}
