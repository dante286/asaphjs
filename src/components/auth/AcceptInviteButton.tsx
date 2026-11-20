"use client";

import { useState, useTransition } from "react";
import { acceptInviteAction } from "@/actions/members";

export function AcceptInviteButton({ token }: { token: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <button
        className="btn btn-primary"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            try {
              // Success redirects; an expected refusal comes back as `{ error }`,
              // since a thrown message wouldn't survive production.
              const result = await acceptInviteAction(token);
              if (result?.error) setError(result.error);
            } catch (err) {
              const digest = (err as { digest?: unknown })?.digest;
              if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) throw err;
              setError("Couldn't accept the invite. Please try again.");
            }
          })
        }
      >
        {isPending ? "Accepting…" : "Accept invite"}
      </button>
      {error && <div style={{ marginTop: 10, fontSize: 12.5, color: "#b5544a" }}>{error}</div>}
    </div>
  );
}
