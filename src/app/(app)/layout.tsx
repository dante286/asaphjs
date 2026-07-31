import { requireSession } from "@/lib/auth/session";
import { TopNav } from "@/components/nav/TopNav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();

  return (
    <div style={{ minHeight: "100vh", background: "var(--color-bg)", color: "var(--color-text)" }}>
      <TopNav userName={session.user.name} />
      {children}
    </div>
  );
}
