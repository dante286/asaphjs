import Link from "next/link";
import { Blueprint } from "@/components/ui/Blueprint";
import { timeAgo } from "@/lib/format";
import type { CollectionCardRow } from "@/db/queries/collections";

export function CollectionCard({ row }: { row: CollectionCardRow }) {
  const { collection, itemCount, verifiedCount, lentCount, isOwner, ownerName } = row;
  const unverified = Math.max(itemCount - verifiedCount - lentCount, 0);
  const segments = [
    { color: "var(--color-accent-700)", count: verifiedCount },
    { color: "var(--color-accent-300)", count: lentCount },
    { color: "var(--color-neutral-300)", count: unverified },
  ].filter((s) => s.count > 0);

  const facts: string[] = [];
  if (itemCount > 0) facts.push(`${verifiedCount} verified`);
  if (lentCount > 0) facts.push(`${lentCount} lent out`);
  facts.push(`${collection.fields.length} fields`);

  return (
    <Link href={`/collections/${collection.slug}`} style={{ textDecoration: "none", color: "inherit" }}>
      <Blueprint
        as="div"
        className="card"
        style={{ cursor: "pointer", padding: 16, gap: 12 }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
          <div>
            <div className="card-kicker">
              {collection.templateKey ?? "Custom"}
              {!isOwner && ownerName ? ` · shared by ${ownerName}` : ""}
            </div>
            <div className="card-title" style={{ fontSize: 22, marginTop: 2 }}>
              {collection.name}
            </div>
          </div>
          <div style={{ fontFamily: "var(--font-heading)", fontSize: 30, lineHeight: 1, color: "var(--color-accent-700)" }}>
            {itemCount}
          </div>
        </div>
        {segments.length > 0 && (
          <div style={{ display: "flex", height: 5, gap: 2 }}>
            {segments.map((s, i) => (
              <div
                key={i}
                style={{ height: "100%", background: s.color, width: `${(s.count / itemCount) * 100}%` }}
              />
            ))}
          </div>
        )}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 14, fontSize: 11.5, color: "color-mix(in srgb, var(--color-text) 60%, transparent)" }}>
          {facts.map((f, i) => (
            <span key={i}>{f}</span>
          ))}
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderTop: "1px solid var(--color-divider)",
            paddingTop: 10,
            fontSize: 11,
            color: "color-mix(in srgb, var(--color-text) 50%, transparent)",
          }}
        >
          <span>Updated {timeAgo(collection.updatedAt)}</span>
          <span>{collection.shareEnabled ? "Public link on" : isOwner ? "Private" : "Shared with you"}</span>
        </div>
      </Blueprint>
    </Link>
  );
}
