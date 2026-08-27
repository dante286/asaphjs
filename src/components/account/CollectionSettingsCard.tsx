"use client";

import { useState, useTransition } from "react";
import { Blueprint } from "@/components/ui/Blueprint";
import { Dialog } from "@/components/ui/Dialog";
import { deleteCollectionAction, updateCollectionSettingsAction } from "@/actions/collections";

export function CollectionSettingsCard({
  collectionId,
  collectionName,
  collectionSlug,
  itemCount,
  templateKey,
}: {
  collectionId: string;
  collectionName: string;
  collectionSlug: string;
  itemCount: number;
  templateKey: string | null;
}) {
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState(collectionName);
  // The card keeps its own copy of the saved name and slug: the rename regenerates
  // the slug, and showing the new URL is the only signal that the old one is gone.
  const [saved, setSaved] = useState({ name: collectionName, slug: collectionSlug });
  const [renamed, setRenamed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [typedName, setTypedName] = useState("");

  const trimmed = name.trim();
  const canRename = !isPending && trimmed.length > 0 && trimmed !== saved.name;

  function rename() {
    if (!canRename) return;
    setError(null);
    setRenamed(false);
    startTransition(async () => {
      try {
        const next = await updateCollectionSettingsAction(collectionId, { name: trimmed });
        setSaved(next);
        setName(next.name);
        setRenamed(true);
      } catch {
        setError("Couldn't rename this collection.");
      }
    });
  }

  function destroy() {
    setError(null);
    startTransition(async () => {
      try {
        await deleteCollectionAction(collectionId);
        setConfirmOpen(false);
      } catch {
        setError("Couldn't delete this collection.");
        setConfirmOpen(false);
      }
    });
  }

  return (
    <Blueprint style={{ padding: "16px 18px 18px", marginBottom: 26, display: "grid", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <span style={{ fontFamily: "var(--font-heading)", fontSize: 19 }}>{saved.name}</span>
        <span style={{ fontSize: 11.5, color: "color-mix(in srgb, var(--color-text) 55%, transparent)" }}>
          {templateKey ?? "Custom"} · {itemCount} item{itemCount === 1 ? "" : "s"}
        </span>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input
          className="input"
          type="text"
          aria-label={`Name for ${saved.name}`}
          value={name}
          maxLength={120}
          disabled={isPending}
          onChange={(e) => {
            setName(e.target.value);
            setRenamed(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              rename();
            }
          }}
          style={{ flex: "1 1 220px", height: 34 }}
        />
        <button className="btn btn-secondary" style={{ height: 34 }} type="button" onClick={rename} disabled={!canRename}>
          {isPending ? "Saving…" : "Rename"}
        </button>
        {renamed && <span style={{ fontSize: 12, color: "var(--color-accent-700)" }}>Saved.</span>}
        {error && <span style={{ fontSize: 12, color: "#b5544a" }}>{error}</span>}
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          fontSize: 12.5,
          borderTop: "1px solid var(--color-divider)",
          paddingTop: 12,
        }}
      >
        <span style={{ color: "color-mix(in srgb, var(--color-text) 60%, transparent)" }}>
          Lives at{" "}
          <a href={`/collections/${saved.slug}`} style={{ color: "var(--color-accent-700)" }}>
            /collections/{saved.slug}
          </a>{" "}
          — renaming moves it, and links to the old address stop working.
        </span>
        <button
          className="btn btn-ghost"
          style={{ fontSize: 12, color: "#b5544a" }}
          type="button"
          disabled={isPending}
          onClick={() => {
            setTypedName("");
            setConfirmOpen(true);
          }}
        >
          Delete collection
        </button>
      </div>

      {confirmOpen && (
        <Dialog
          open
          onClose={() => {
            if (!isPending) setConfirmOpen(false);
          }}
          title={`Delete ${saved.name}?`}
          actions={
            <>
              <button className="btn btn-ghost" type="button" disabled={isPending} onClick={() => setConfirmOpen(false)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                type="button"
                disabled={isPending || typedName.trim() !== saved.name}
                onClick={destroy}
              >
                {isPending ? "Deleting…" : "Delete forever"}
              </button>
            </>
          }
        >
          <div style={{ display: "grid", gap: 12 }}>
            <p style={{ margin: 0 }}>
              This removes {itemCount} item{itemCount === 1 ? "" : "s"}, every photo uploaded to
              {itemCount === 1 ? " it" : " them"}, and everyone&apos;s access to this collection.
              It can&apos;t be undone.
            </p>
            <div className="field" style={{ gap: 4 }}>
              <label>
                Type <strong>{saved.name}</strong> to confirm
              </label>
              <input
                className="input"
                type="text"
                autoFocus
                value={typedName}
                disabled={isPending}
                onChange={(e) => setTypedName(e.target.value)}
              />
            </div>
          </div>
        </Dialog>
      )}
    </Blueprint>
  );
}
