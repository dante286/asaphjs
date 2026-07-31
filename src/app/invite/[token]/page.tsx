import Link from "next/link";
import { getSession } from "@/lib/auth/session";
import { Blueprint } from "@/components/ui/Blueprint";
import { AcceptInviteButton } from "@/components/auth/AcceptInviteButton";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const session = await getSession();

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "clamp(16px,4vw,48px)" }}>
      <Blueprint style={{ maxWidth: 440, padding: "clamp(20px,3vw,32px)", background: "var(--color-surface)" }}>
        <h2 style={{ marginTop: 0 }}>You&rsquo;ve been invited to a collection</h2>
        {session ? (
          <>
            <p style={{ fontSize: 14 }}>
              Signed in as {session.user.email}. Accept the invite to add this collection to your
              dashboard.
            </p>
            <AcceptInviteButton token={token} />
          </>
        ) : (
          <>
            <p style={{ fontSize: 14 }}>Sign in or create an account with the email this invite was sent to.</p>
            <Link href={`/auth?next=/invite/${token}`} className="btn btn-primary">
              Continue
            </Link>
          </>
        )}
      </Blueprint>
    </div>
  );
}
