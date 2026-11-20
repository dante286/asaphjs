"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Blueprint } from "@/components/ui/Blueprint";
import { Tag } from "@/components/ui/Tag";
import { FieldCell } from "@/components/collection/FieldCell";
import { CoverPhoto } from "@/components/collection/CoverPhoto";
import { MetadataLookupPanel } from "@/components/collection/MetadataLookupPanel";
import { SaveStatusIndicator, type SaveStatus } from "@/components/collection/SaveStatusIndicator";
import { ConflictError, deleteItemRequest, patchItemRequest, type Item } from "@/lib/api/items-client";
import { markItemsStale } from "@/lib/api/items-cache";
import { isTitleField, isFixedColumnField, getFieldValue, buildPatchForField } from "@/lib/fields/item-values";
import type { ItemPatch, ItemNeighbors } from "@/db/queries/items";
import type { collections } from "@/db/schema";
import type { FieldDef } from "@/lib/fields/field-def";
import type { LookupConfig } from "@/lib/metadata/lookup-config";
import { trackedFeatures } from "@/lib/collection-features";

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
  lookup,
}: {
  collection: typeof collections.$inferSelect;
  item: Item;
  canEdit: boolean;
  neighbors: ItemNeighbors;
  /** null when this collection's template has no provider, or its keys aren't set. */
  lookup: LookupConfig | null;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [item, setItem] = useState(initialItem);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ kind: "idle" });
  // Debounced saves not sent yet, by field: the timer, and the save it will run.
  const pendingSaves = useRef<Map<string, { timer: ReturnType<typeof setTimeout>; run: (keepalive?: boolean) => void }>>(
    new Map(),
  );

  // Viewers get no lookup panel — matching is an edit.
  const showLookupPanel = canEdit ? lookup : null;
  const fields = collection.fields;
  const tracked = trackedFeatures(collection.features);
  const detailFields = fields
    .map((field, index) => ({ field, index }))
    .filter(({ field, index }) => !isTitleField(index) && !isFixedColumnField(field.id));

  const badges = fields
    .map((field, index) => ({ field, index }))
    .filter(({ field, index }) => field.type === "checkbox" && !isTitleField(index) && !isFixedColumnField(field.id))
    .filter(({ field, index }) => Boolean(getFieldValue(item, field, index)))
    .map(({ field }) => field.label)
    .concat(tracked.verified && item.verified ? ["Verified"] : [])
    .slice(0, 3);

  const subtitle = detailFields
    .map(({ field, index }) => getFieldValue(item, field, index))
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .slice(0, 3)
    .join(" · ");

  // The If-Match for the next save. It comes from the server's last answer, not
  // from `item`: optimistic edits never change `updatedAt`, and a debounce
  // timer holds the `item` from the render that set it. It's a ref because a
  // queued save runs in the same tick the previous one resolves, before React
  // has re-rendered.
  const latestUpdatedAt = useRef(initialItem.updatedAt);
  // Saves go out one at a time, each with the `updatedAt` its predecessor
  // returned. Sent together, the second would carry the same If-Match as the
  // first and get a 409.
  const saveQueue = useRef<Promise<void>>(Promise.resolve());

  // The inputs below are uncontrolled, so they only show a value that changed
  // outside them (a lookup match, the server's copy after a 409) once
  // they remount. This is their key. It isn't bumped for our own saves, which
  // would remount an input mid-typing and drop its focus.
  const [formKey, setFormKey] = useState(0);

  function acceptExternalItem(updated: Item) {
    acceptServerItem(updated);
    setFormKey((k) => k + 1);
  }

  function acceptServerItem(updated: Item) {
    latestUpdatedAt.current = updated.updatedAt;
    setItem(updated);
    // The collection view's cached list still has the old row.
    void markItemsStale(queryClient, collection.id);
  }

  function commit(patch: ItemPatch, debounceKey?: string) {
    setSaveStatus({ kind: "saving" });
    const run = (keepalive = false) => {
      saveQueue.current = saveQueue.current.then(() =>
        patchItemRequest(collection.id, item.id, patch, latestUpdatedAt.current, { keepalive })
          .then((updated) => {
            acceptServerItem(updated);
            setSaveStatus({ kind: "saved", at: new Date() });
          })
          .catch((err) => {
            if (err instanceof ConflictError) acceptExternalItem(err.current);
            setSaveStatus({ kind: "error" });
          }),
      );
    };

    if (!debounceKey) {
      run();
      return;
    }
    const existing = pendingSaves.current.get(debounceKey);
    if (existing) clearTimeout(existing.timer);
    pendingSaves.current.set(debounceKey, {
      run,
      timer: setTimeout(() => {
        pendingSaves.current.delete(debounceKey);
        run();
      }, DEBOUNCE_MS),
    });
  }

  // A debounced edit is only typed, not saved, for its first 400ms. Leaving
  // the page in that window — a breadcrumb, Previous/Next, closing the tab —
  // sends it now rather than dropping it with the timer.
  useEffect(() => {
    const pending = pendingSaves.current;
    const flush = (keepalive: boolean) => {
      for (const { timer, run } of pending.values()) {
        clearTimeout(timer);
        run(keepalive);
      }
      pending.clear();
    };
    const onPageHide = () => flush(true);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      flush(false);
    };
  }, []);

  function handleFieldChange(field: FieldDef, index: number, value: unknown) {
    const patch = buildPatchForField(field, index, value);
    const key = DEBOUNCED_TYPES.has(field.type) ? `field:${field.id}` : undefined;
    commit(patch, key);
    setItem((prev) => ({ ...prev, ...(patch as Partial<Item>), values: { ...prev.values, ...(patch.values ?? {}) } }));
  }

  async function handleDelete() {
    if (!window.confirm(`Delete "${item.title}"? This can't be undone.`)) return;
    try {
      await deleteItemRequest(collection.id, item.id);
    } catch {
      window.alert(`Couldn't delete "${item.title}". Try again.`);
      return;
    }
    // Or the list we're going back to shows the deleted row for up to 30s.
    await markItemsStale(queryClient, collection.id);
    router.push(`/collections/${collection.slug}`);
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <div style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "color-mix(in srgb, var(--color-text) 55%, transparent)" }}>
          <Link href={`/collections/${collection.slug}`} style={{ textDecoration: "none" }}>
            Collections
          </Link>{" "}
          / <Link href={`/collections/${collection.slug}`} style={{ textDecoration: "none" }}>{collection.name}</Link> / {item.title}
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
            onItemUpdate={acceptExternalItem}
            onStatusChange={setSaveStatus}
          />

          {showLookupPanel && (
            <MetadataLookupPanel
              collectionId={collection.id}
              item={item}
              lookup={showLookupPanel}
              canEdit={canEdit}
              onItemUpdate={acceptExternalItem}
              onStatusChange={setSaveStatus}
            />
          )}

          {(tracked.verified || tracked.lending) && (
            <Blueprint key={formKey} style={{ padding: "12px 14px", display: "grid", gap: 10, fontSize: 12.5 }}>
              {tracked.verified && (
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
              )}
              {tracked.lending && (
                <>
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
                    {item.borrower ? "Lent out." : "Fill this in when you lend it out."}
                  </div>
                </>
              )}
            </Blueprint>
          )}

          {/* The lookup panel above carries the match provenance when it renders;
              this line covers the cases where it doesn't (viewer, or a collection
              with no provider) so a matched item never looks unmatched. */}
          <div style={{ fontSize: 11.5, color: "color-mix(in srgb, var(--color-text) 50%, transparent)", lineHeight: 1.5 }}>
            {showLookupPanel || !item.externalRef
              ? `Added ${new Date(item.createdAt).toLocaleDateString()}`
              : `Metadata matched from ${item.externalRef.source} · added ${new Date(item.createdAt).toLocaleDateString()}`}
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
              key={formKey}
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
              <Blueprint key={formKey} style={{ padding: "4px 18px 14px" }}>
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
              key={formKey}
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
