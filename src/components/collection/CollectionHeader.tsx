import Link from "next/link";
import { Tag } from "@/components/ui/Tag";
import type { collections } from "@/db/schema";
import type { Role } from "@/types";

export function CollectionHeader({
  collection,
  role,
}: {
  collection: typeof collections.$inferSelect;
  role: Role;
}) {
  const fieldSummary = collection.fields.map((f) => f.label).join(", ");

  return (
    <>
      <div
        style={{
          fontSize: 11,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "color-mix(in srgb, var(--color-text) 55%, transparent)",
          marginBottom: 10,
        }}
      >
        <Link href="/" style={{ textDecoration: "none" }}>
          Collections
        </Link>{" "}
        / {collection.name}
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h1 style={{ fontSize: "clamp(32px,4.6vw,44px)", margin: 0 }}>{collection.name}</h1>
            <Tag variant="accent">{collection.templateKey ?? "Custom"}</Tag>
            <Tag variant="outline">{collection.shareEnabled ? "Public link on" : "Private"}</Tag>
          </div>
          <div style={{ fontSize: 13, color: "color-mix(in srgb, var(--color-text) 60%, transparent)", marginTop: 4 }}>
            {fieldSummary}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {(role === "owner" || role === "editor") && (
            <>
              <Link href={`/collections/${collection.slug}/fields`} className="btn btn-secondary">
                Fields
              </Link>
              <Link href={`/collections/${collection.slug}/import`} className="btn btn-secondary">
                Import CSV
              </Link>
            </>
          )}
        </div>
      </div>
    </>
  );
}
