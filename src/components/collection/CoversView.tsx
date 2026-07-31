import { Blueprint } from "@/components/ui/Blueprint";
import type { FieldDef } from "@/lib/fields/field-def";
import { getFieldValue } from "@/lib/fields/item-values";
import type { Item } from "@/lib/api/items-client";

const PLATES = [
  "var(--color-accent-200)",
  "var(--color-neutral-200)",
  "var(--color-accent-300)",
  "var(--color-neutral-300)",
  "var(--color-accent-100)",
];

export function CoversView({
  items,
  fields,
  onOpenItem,
}: {
  items: Item[];
  fields: FieldDef[];
  onOpenItem: (item: Item) => void;
}) {
  const cardField = fields.find((f, i) => f.showOnCard && i !== 0);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(clamp(130px,15vw,182px),1fr))", gap: "clamp(14px,2vw,24px)" }}>
      {items.map((item, i) => {
        const sub = cardField ? String(getFieldValue(item, cardField, fields.indexOf(cardField)) ?? "") : "";
        const flag = item.verified ? "Verified" : item.borrower ? `Lent — ${item.borrower}` : "";
        return (
          <div key={item.id} style={{ cursor: "pointer" }} onClick={() => onOpenItem(item)}>
            <Blueprint
              className="duotone"
              style={{
                aspectRatio: "3/4",
                background: item.coverUrl ? undefined : PLATES[i % PLATES.length],
                display: "grid",
                placeItems: item.coverUrl ? "stretch" : "end start",
                padding: item.coverUrl ? 0 : 12,
                overflow: "hidden",
              }}
            >
              {item.coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.coverUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                <span
                  style={{
                    fontFamily: "var(--font-heading)",
                    fontSize: 12,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    color: "color-mix(in srgb, var(--color-text) 45%, transparent)",
                  }}
                >
                  Cover
                </span>
              )}
            </Blueprint>
            <div style={{ marginTop: 9, fontFamily: "var(--font-heading)", fontSize: 15, lineHeight: 1.15 }}>
              {item.title}
            </div>
            <div style={{ fontSize: 11.5, color: "color-mix(in srgb, var(--color-text) 55%, transparent)", display: "flex", gap: 7, flexWrap: "wrap" }}>
              {sub && <span>{sub}</span>}
              {flag && <span>{flag}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
