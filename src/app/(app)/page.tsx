import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { listCollectionsForUser } from "@/db/queries/collections";
import { CollectionCard } from "@/components/dashboard/CollectionCard";
import { Blueprint } from "@/components/ui/Blueprint";

export default async function DashboardPage() {
  const session = await requireSession();
  const rows = await listCollectionsForUser(session.user.id);

  const totals = [
    { label: "Collections", value: rows.length },
    { label: "Total items", value: rows.reduce((sum, r) => sum + r.itemCount, 0) },
    { label: "Verified", value: rows.reduce((sum, r) => sum + r.verifiedCount, 0) },
    { label: "Lent out", value: rows.reduce((sum, r) => sum + r.lentCount, 0) },
  ];

  return (
    <div style={{ maxWidth: 1400, margin: "0 auto", padding: "clamp(20px,3.5vw,44px) clamp(14px,3vw,32px) 80px" }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 18, flexWrap: "wrap", marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--color-accent-700)" }}>
            Library index
          </div>
          <h1 style={{ fontSize: "clamp(34px,5vw,46px)", margin: "4px 0 0" }}>Collections</h1>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link href="/collections/new" className="btn btn-primary">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M12 5v14"></path>
              <path d="M5 12h14"></path>
            </svg>
            New collection
          </Link>
        </div>
      </div>

      <div style={{ display: "flex", gap: 26, flexWrap: "wrap", padding: "14px 0 22px", borderBottom: "1px solid var(--color-divider)", marginBottom: 26 }}>
        {totals.map((t) => (
          <div key={t.label}>
            <div style={{ fontFamily: "var(--font-heading)", fontSize: "clamp(26px,3.4vw,34px)", lineHeight: 1 }}>{t.value}</div>
            <div style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "color-mix(in srgb, var(--color-text) 55%, transparent)" }}>
              {t.label}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(268px,1fr))", gap: "clamp(18px,2.4vw,30px)" }}>
        {rows.map((row) => (
          <CollectionCard key={row.collection.id} row={row} />
        ))}
        <Link href="/collections/new" style={{ textDecoration: "none" }}>
          <Blueprint
            style={{ minHeight: 180, display: "grid", placeItems: "center", cursor: "pointer", borderStyle: "dashed" }}
          >
            <div style={{ textAlign: "center", color: "var(--color-accent-700)" }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ margin: "0 auto 8px" }}>
                <path d="M12 5v14"></path>
                <path d="M5 12h14"></path>
              </svg>
              <div style={{ fontFamily: "var(--font-heading)", fontSize: 16 }}>New collection</div>
              <div style={{ fontSize: 11, opacity: 0.7 }}>From a template, blank, or a CSV</div>
            </div>
          </Blueprint>
        </Link>
      </div>
    </div>
  );
}
