import { Blueprint } from "@/components/ui/Blueprint";
import type { CollectionStats } from "@/db/queries/stats";

export function StatTiles({ stats }: { stats: CollectionStats }) {
  const tiles: { value: number | string; label: string; note?: string }[] = [
    { value: stats.itemCount, label: "Items" },
    {
      value: stats.verifiedCount,
      label: "Verified",
      note: stats.itemCount ? `${Math.round((stats.verifiedCount / stats.itemCount) * 100)}%` : "",
    },
    { value: stats.lentCount, label: "Lent out" },
  ];
  if (stats.facetLabel) {
    tiles.push({ value: stats.distinctFacetCount ?? 0, label: `Distinct ${stats.facetLabel.toLowerCase()}` });
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 14, margin: "26px 0" }}>
      {tiles.map((s) => (
        <Blueprint key={s.label} style={{ padding: "14px 16px" }}>
          <div style={{ fontFamily: "var(--font-heading)", fontSize: "clamp(28px,3.2vw,36px)", lineHeight: 1 }}>
            {s.value}
          </div>
          <div
            style={{
              fontSize: 10.5,
              letterSpacing: "0.09em",
              textTransform: "uppercase",
              color: "color-mix(in srgb, var(--color-text) 55%, transparent)",
              marginTop: 4,
            }}
          >
            {s.label}
          </div>
          {s.note && <div style={{ fontSize: 11, color: "var(--color-accent-700)", marginTop: 2 }}>{s.note}</div>}
        </Blueprint>
      ))}
    </div>
  );
}
