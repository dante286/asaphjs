"use client";

import { useActionState } from "react";
import { Blueprint } from "@/components/ui/Blueprint";
import { sendVerificationEmailAction, type ActionState } from "@/actions/account";

/**
 * The account's address: unconfirmed with a button to send the link, or the
 * outcome of a link just followed. Rendered by the account page only when there
 * is something to say. It's a card of its own because the profile section is
 * one `<form>`, and this button mustn't submit it.
 */
export function EmailVerificationCard({
  email,
  status,
}: {
  email: string;
  /** `link_failed`: Better Auth sent the browser back with an `error` (expired, used, or for another account). */
  status: "unverified" | "just_verified" | "link_failed";
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    sendVerificationEmailAction,
    undefined,
  );

  if (status === "just_verified") {
    return (
      <Blueprint style={{ padding: 14, marginBottom: 26, fontSize: 13 }}>
        <span role="status">{email} is confirmed. You can send invites now.</span>
      </Blueprint>
    );
  }

  return (
    <form action={formAction}>
      <Blueprint style={{ padding: 14, marginBottom: 26, display: "grid", gap: 10, fontSize: 13 }}>
        <span role="status">
          {status === "link_failed"
            ? "That confirmation link has expired or was already used. Send yourself a new one."
            : `Confirm that ${email} is your address before sending invites.`}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button className="btn btn-secondary" type="submit" disabled={pending || state?.ok}>
            {pending ? "Sending…" : state?.ok ? "Sent" : "Send confirmation email"}
          </button>
          {state?.ok && (
            <span style={{ fontSize: 12, color: "var(--color-accent-700)" }}>
              Check {email} for the link. It expires in an hour.
            </span>
          )}
          {state?.error && <span style={{ fontSize: 12, color: "#b5544a" }}>{state.error}</span>}
        </div>
      </Blueprint>
    </form>
  );
}
