import Link from "next/link";
import { findInviteByToken } from "@/db/queries/registration-invites";
import { getSession } from "@/lib/auth/session";
import { Blueprint } from "@/components/ui/Blueprint";
import { JoinForm } from "@/components/auth/JoinForm";

/**
 * Where a registration invite lands: an invitation to the instance, which lets
 * one address register even with signups closed. Not `/invite/[token]`, which
 * is the collection invite page and wants an account that already exists.
 *
 * Unlike the reset page, the token is looked up on load, because the address
 * shown read-only in the form comes from it. That's only for display: the
 * action looks it up again on submit, and the gate in `betterAuth()` once more.
 *
 * Outside the middleware's matcher, so it's reachable signed out.
 */
export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const session = await getSession();
  const invite = session ? undefined : await findInviteByToken(token);

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "clamp(16px,4vw,48px)" }}>
      {invite ? (
        <JoinForm token={token} email={invite.email} />
      ) : (
        <Blueprint style={{ maxWidth: 420, padding: "clamp(20px,3vw,32px)", background: "var(--color-surface)" }}>
          {session ? (
            <>
              <h2 style={{ marginTop: 0 }}>You already have an account</h2>
              <p style={{ fontSize: 14 }}>
                You&rsquo;re signed in as {session.user.email}. This invitation is for creating a new
                account, so there&rsquo;s nothing to accept here.
              </p>
              <Link href="/" className="btn btn-primary">
                Go to your dashboard
              </Link>
            </>
          ) : (
            <>
              <h2 style={{ marginTop: 0 }}>This invitation can&rsquo;t be used</h2>
              <p style={{ fontSize: 14 }}>
                It has expired, was already used, or was withdrawn. Ask whoever invited you to send a new
                one.
              </p>
              <Link href="/auth" className="btn btn-primary">
                Go to sign in
              </Link>
            </>
          )}
        </Blueprint>
      )}
    </div>
  );
}
