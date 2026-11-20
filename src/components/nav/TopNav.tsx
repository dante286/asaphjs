import Link from "next/link";

export function TopNav({ userName }: { userName: string }) {
  return (
    <div
      className="nav"
      style={{
        borderBottom: "1px solid var(--color-divider)",
        gap: "clamp(10px,2vw,22px)",
        flexWrap: "wrap",
        padding: "12px clamp(14px,3vw,32px)",
        background: "var(--color-bg)",
        position: "sticky",
        top: 0,
        zIndex: 5,
      }}
    >
      <Link
        href="/"
        className="nav-brand"
        style={{ letterSpacing: "0.04em", marginRight: "clamp(8px,3vw,32px)" }}
      >
        ASAPH
      </Link>
      <Link href="/" style={{ fontFamily: "var(--font-heading)", letterSpacing: "0.02em" }}>
        Collections
      </Link>
      <Link
        href="/collections/new"
        style={{ fontFamily: "var(--font-heading)", letterSpacing: "0.02em" }}
      >
        New collection
      </Link>
      <Link
        href="/account"
        style={{ fontFamily: "var(--font-heading)", letterSpacing: "0.02em" }}
      >
        Settings
      </Link>
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
        <Link href="/account" className="btn btn-secondary" style={{ gap: 8 }}>
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <circle cx="12" cy="8" r="4"></circle>
            <path d="M4 21c0-4 3.6-6 8-6s8 2 8 6"></path>
          </svg>
          {userName}
        </Link>
      </div>
    </div>
  );
}
