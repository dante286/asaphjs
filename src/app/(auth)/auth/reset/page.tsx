import Link from "next/link";
import { Blueprint } from "@/components/ui/Blueprint";
import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";

/**
 * Where the reset email lands. The token isn't checked here: Better Auth checks
 * it when the form is submitted, which is the only check that counts, and one
 * on page load could pass for a link that then expires while the person types.
 * An expired or used one gets its answer on submit.
 *
 * Outside the middleware's matcher, so it's reachable signed out — which is the
 * whole point of it.
 */
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "clamp(16px,4vw,48px)" }}>
      {token ? (
        <ResetPasswordForm token={token} />
      ) : (
        <Blueprint style={{ maxWidth: 420, padding: "clamp(20px,3vw,32px)", background: "var(--color-surface)" }}>
          <p style={{ fontSize: 14, marginTop: 0 }}>
            This reset link is missing its token. Open the link from the email again, or ask for a new one.
          </p>
          <Link href="/auth" className="btn btn-primary">
            Back to sign in
          </Link>
        </Blueprint>
      )}
    </div>
  );
}
