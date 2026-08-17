"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Blueprint } from "@/components/ui/Blueprint";
import { Tag } from "@/components/ui/Tag";
import { FieldCell } from "@/components/collection/FieldCell";
import { CoverPhoto } from "@/components/collection/CoverPhoto";
import { SaveStatusIndicator, type SaveStatus } from "@/components/collection/SaveStatusIndicator";
import { ConflictError, deleteItemRequest, patchItemRequest, type Item } from "@/lib/api/items-client";
import { isTitleField, isFixedColumnField, getFieldValue, buildPatchForField } from "@/lib/fields/item-values";
import type { ItemPatch, ItemNeighbors } from "@/db/queries/items";
import type { collections } from "@/db/schema";
import type { FieldDef } from "@/lib/fields/field-def";

const DEBOUNCED_TYPES = new Set(["text", "longtext", "number", "url", "currency", "tags"]);
const DEBOUNCE_MS = 400;

const PLATES = [
  "var(--color-accent-200)",
  "var(--color-neutral-200)",
  "var(--color-accent-300)",
  "var(--color-neutral-300)",
  "var(--color-accent-100)",
];

export function ItemDetail({
  collection,
  item: initialItem,
  canEdit,
  neighbors,
}: {
  collection: typeof collections.$inferSelect;
  item: Item;
  canEdit: boolean;
  neighbors: ItemNeighbors;
}) {
  const router = useRouter();
  const [item, setItem] = useState(initialItem);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ kind: "idle" });
  const debounceTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const fields = collection.fields;
  const detailFields = fields
    .map((field, index) => ({ field, index }))
    .filter(({ field, index }) => !isTitleField(index) && !isFixedColumnField(field.id));

  const badges = fields
    .map((field, index) => ({ field, index }))
    .filter(({ field, index }) => field.type === "checkbox" && !isTitleField(index) && !isFixedColumnField(field.id))
    .filter(({ field, index }) => Boolean(getFieldValue(item, field, index)))
    .map(({ field }) => field.label)
    .concat(item.verified ? ["Verified"] : [])
    .slice(0, 3);

  const subtitle = detailFields
    .map(({ field, index }) => getFieldValue(item, field, index))
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .slice(0, 3)
    .join(" · ");

  function commit(patch: ItemPatch, debounceKey?: string) {
    setSaveStatus({ kind: "saving" });
    const run = () =>
      patchItemRequest(collection.id, item.id, patch, item.updatedAt)
        .then((updated) => {
          setItem(updated);
          setSaveStatus({ kind: "saved", at: new Date() });
        })
        .catch((err) => {
          if (err instanceof ConflictError) setItem(err.current);
          setSaveStatus({ kind: "error" });
        });

    if (!debounceKey) {
      run();
      return;
    }
    const existing = debounceTimers.current.get(debounceKey);
    if (existing) clearTimeout(existing);
    debounceTimers.current.set(
      debounceKey,
      setTimeout(() => {
        run();
        debounceTimers.current.delete(debounceKey);
      }, DEBOUNCE_MS),
    );
  }

  function handleFieldChange(field: FieldDef, index: number, value: unknown) {
    const patch = buildPatchForField(field, index, value);
    const key = DEBOUNCED_TYPES.has(field.type) ? `field:${field.id}` : undefined;
    commit(patch, key);
    setItem((prev) => ({ ...prev, ...(patch as Partial<Item>), values: { ...prev.values, ...(patch.values ?? {}) } }));
  }

  async function handleDelete() {
    if (!window.confirm(`Delete "${item.title}"? This can't be undone.`)) return;
    await deleteItemRequest(collection.id, item.id);
    router.push(`/collections/${collection.slug}`);
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <div style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "color-mix(in srgb, var(--color-text) 55%, transparent)" }}>
          <a href={`/collections/${collection.slug}`} style={{ textDecoration: "none" }}>
            Collections
          </a>{" "}
          / <a href={`/collections/${collection.slug}`} style={{ textDecoration: "none" }}>{collection.name}</a> / {item.title}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ fontSize: 12.5 }}
            disabled={!neighbors.prevId}
            onClick={() => neighbors.prevId && router.push(`/collections/${collection.slug}/items/${neighbors.prevId}`)}
          >
            ‹ Previous
          </button>
          <span style={{ fontSize: 11.5, color: "color-mix(in srgb, var(--color-text) 55%, transparent)" }}>
            {neighbors.position} of {neighbors.total}
          </span>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ fontSize: 12.5 }}
            disabled={!neighbors.nextId}
            onClick={() => neighbors.nextId && router.push(`/collections/${collection.slug}/items/${neighbors.nextId}`)}
          >
            Next ›
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,270px),1fr))", gap: "clamp(20px,3vw,40px)", alignItems: "start" }}>
        <div style={{ maxWidth: 330, display: "grid", gap: 12 }}>
          <CoverPhoto
            collectionId={collection.id}
            item={item}
            canEdit={canEdit}
            plate={PLATES[neighbors.position % PLATES.length]}
            onItemUpdate={setItem}
            onStatusChange={setSaveStatus}
          />

          <Blueprint style={{ padding: "12px 14px", display: "grid", gap: 10, fontSize: 12.5 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 9, cursor: canEdit ? "pointer" : "default" }}>
              <input
                type="checkbox"
                defaultChecked={item.verified}
                disabled={!canEdit}
                onChange={(e) => {
                  commit({ verified: e.target.checked });
                  setItem((prev) => ({ ...prev, verified: e.target.checked }));
                }}
                style={{ accentColor: "var(--color-accent)", width: 16, height: 16 }}
              />
              Verified — physically confirmed
            </label>
            <div className="field" style={{ gap: 4 }}>
              <label style={{ fontSize: 10.5 }}>Lent to</label>
              <input
                className="input"
                type="text"
                defaultValue={item.borrower ?? ""}
                placeholder="Nobody — in your possession"
                disabled={!canEdit}
                onChange={(e) => {
                  const value = e.target.value || null;
                  commit({ borrower: value }, "borrower");
                  setItem((prev) => ({ ...prev, borrower: value }));
                }}
                style={{ height: 32 }}
              />
            </div>
            <div style={{ color: "color-mix(in srgb, var(--color-text) 55%, transparent)" }}>
              {item.borrower ? "Lent out — reminder set for 30 days" : "Fill this in when you lend it out."}
            </div>
          </Blueprint>

          <div style={{ fontSize: 11.5, color: "color-mix(in srgb, var(--color-text) 50%, transparent)", lineHeight: 1.5 }}>
            {item.externalRef
              ? `Metadata matched from ${item.externalRef.source} · added ${new Date(item.createdAt).toLocaleDateString()}`
              : `Added ${new Date(item.createdAt).toLocaleDateString()}`}
          </div>
        </div>

        <div style={{ display: "grid", gap: 22, minWidth: 0 }}>
          <div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
              <Tag variant="accent">{collection.templateKey ?? "Custom"}</Tag>
              {badges.map((b) => (
                <Tag key={b} variant="outline">
                  {b}
                </Tag>
              ))}
            </div>
            <input
              type="text"
              defaultValue={item.title}
              disabled={!canEdit}
              onChange={(e) => {
                commit({ title: e.target.value }, "title");
                setItem((prev) => ({ ...prev, title: e.target.value }));
              }}
              style={{
                font: "inherit",
                fontFamily: "var(--font-heading)",
                fontWeight: "var(--font-heading-weight)" as unknown as number,
                fontSize: "clamp(30px,4.4vw,42px)",
                lineHeight: 1.05,
                border: 0,
                background: "transparent",
                color: "inherit",
                padding: 0,
                width: "100%",
              }}
            />
            {subtitle && (
              <div style={{ fontSize: 14, color: "color-mix(in srgb, var(--color-text) 60%, transparent)", marginTop: 4 }}>{subtitle}</div>
            )}
          </div>

          {detailFields.length > 0 && (
            <div>
              <h6 style={{ marginBottom: 10 }}>Details</h6>
              <Blueprint style={{ padding: "4px 18px 14px" }}>
                <div style={{ display: "grid", gap: 1 }}>
                  {detailFields.map(({ field, index }) => (
                    <div
                      key={field.id}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "minmax(110px,180px) 1fr",
                        gap: 14,
                        alignItems: "center",
                        padding: "9px 0",
                        borderBottom: "1px solid color-mix(in srgb, var(--color-text) 8%, transparent)",
                      }}
                    >
                      <span style={{ fontSize: 10.5, letterSpacing: "0.09em", textTransform: "uppercase", color: "color-mix(in srgb, var(--color-text) 55%, transparent)" }}>
                        {field.label}
                      </span>
                      <FieldCell
                        item={item}
                        field={field}
                        index={index}
                        disabled={!canEdit}
                        onChange={(value) => handleFieldChange(field, index, value)}
                      />
                    </div>
                  ))}
                </div>
              </Blueprint>
            </div>
          )}

          <div>
            <h6 style={{ marginBottom: 10 }}>Notes</h6>
            <textarea
              className="input"
              defaultValue={item.notes ?? ""}
              disabled={!canEdit}
              placeholder="Condition, where you bought it, what's still missing from the set…"
              onChange={(e) => {
                const value = e.target.value || null;
                commit({ notes: value }, "notes");
                setItem((prev) => ({ ...prev, notes: value }));
              }}
              style={{ minHeight: 96, resize: "vertical", fontFamily: "var(--font-body)", lineHeight: 1.5 }}
            />
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", paddingTop: 14, borderTop: "1px solid var(--color-divider)" }}>
            <SaveStatusIndicator status={saveStatus} />
            <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" className="btn btn-secondary" onClick={() => router.push(`/collections/${collection.slug}`)}>
                Back to {collection.name}
              </button>
              {canEdit && (
                <button type="button" className="btn btn-ghost" style={{ color: "var(--color-accent-700)" }} onClick={handleDelete}>
                  Delete item
                </button>
              )}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
