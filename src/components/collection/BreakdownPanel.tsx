import { Blueprint } from "@/components/ui/Blueprint";
import type { BreakdownRow } from "@/db/queries/stats";

export function BreakdownPanel({ title, rows }: { title: string; rows: BreakdownRow[] }) {
  if (rows.length === 0) return null;
  const max = Math.max(...rows.map((r) => r.count), 1);

  return (
    <Blueprint style={{ padding: "18px 20px", marginBottom: 26 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14 }}>
        <h4 style={{ margin: 0 }}>{title}</h4>
      </div>
      <div style={{ display: "grid", gap: 9 }}>
        {rows.map((r) => (
          <div
            key={r.label}
            style={{ display: "grid", gridTemplateColumns: "minmax(90px,150px) 1fr 46px", alignItems: "center", gap: 12, fontSize: 13 }}
          >
            <span>{r.label}</span>
            <span style={{ height: 9, background: "color-mix(in srgb, var(--color-text) 7%, transparent)", display: "block" }}>
              <span style={{ display: "block", height: "100%", background: "var(--color-accent)", width: `${(r.count / max) * 100}%` }} />
            </span>
            <span style={{ fontFamily: "var(--font-heading)", textAlign: "right" }}>{r.count}</span>
          </div>
        ))}
      </div>
    </Blueprint>
  );
}
