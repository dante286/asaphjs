import { Blueprint } from "@/components/ui/Blueprint";
import type { FieldDef } from "@/lib/fields/field-def";
import { getFieldValue } from "@/lib/fields/item-values";
import { thumbUrlFor } from "@/lib/uploads/urls";
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
  /**
   * Optional so this renders read-only. There's no `"use client"` here — the
   * component takes its environment from whoever imports it, and the public
   * share page imports it from a Server Component, where an `onClick` on a host
   * element can't be serialized. No handler, no click target.
   */
  onOpenItem?: (item: Item) => void;
}) {
  const cardField = fields.find((f, i) => f.showOnCard && i !== 0);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(clamp(130px,15vw,182px),1fr))", gap: "clamp(14px,2vw,24px)" }}>
      {items.map((item, i) => {
        const sub = cardField ? String(getFieldValue(item, cardField, fields.indexOf(cardField)) ?? "") : "";
        const flag = item.verified ? "Verified" : item.borrower ? `Lent — ${item.borrower}` : "";
        // Uploads have a grid-sized derivative; provider covers come back as-is.
        const cover = thumbUrlFor(item.coverUrl);
        return (
          <div
            key={item.id}
            style={onOpenItem ? { cursor: "pointer" } : undefined}
            onClick={onOpenItem ? () => onOpenItem(item) : undefined}
          >
            <Blueprint
              className="duotone"
              style={{
                aspectRatio: "3/4",
                background: cover ? undefined : PLATES[i % PLATES.length],
                display: "grid",
                placeItems: cover ? "stretch" : "end start",
                padding: cover ? 0 : 12,
                overflow: "hidden",
              }}
            >
              {cover ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={cover} alt="" loading="lazy" decoding="async" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
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
