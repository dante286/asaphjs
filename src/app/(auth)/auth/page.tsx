import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { signupsAllowed } from "@/lib/auth/signups";
import { AuthForm } from "@/components/auth/AuthForm";

export default async function AuthPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const session = await getSession();
  if (session) redirect("/");

  const { next } = await searchParams;

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        gridTemplateColumns: "1fr",
        placeItems: "center",
        padding: "clamp(16px,4vw,48px)",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 980,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))",
          gap: "clamp(20px,4vw,48px)",
          alignItems: "center",
        }}
      >
        <div>
          <div
            style={{
              fontSize: 10,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "var(--color-accent-700)",
            }}
          >
            Collection management · v2
          </div>
          <h1 style={{ fontSize: "clamp(40px,6vw,64px)", margin: "8px 0 14px", letterSpacing: "-0.02em" }}>
            ASAPH
          </h1>
          <p
            style={{
              maxWidth: "38ch",
              fontSize: 15,
              color: "color-mix(in srgb, var(--color-text) 70%, transparent)",
            }}
          >
            Every collection you keep — games, books, manga, vinyl, bricks — on one schema.
            Define a collection from a template, extend it with your own fields, and stop
            maintaining a table per hobby.
          </p>
        </div>

        {/* getSession() reads headers(), so this page is dynamic and
            ALLOW_SIGNUPS is read per request rather than frozen into a build. */}
        <AuthForm next={next || "/"} allowSignups={signupsAllowed()} />
      </div>
    </div>
  );
}
