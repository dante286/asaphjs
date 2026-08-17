"use client";

import { useRef, useState } from "react";
import { Blueprint } from "@/components/ui/Blueprint";
import type { SaveStatus } from "@/components/collection/SaveStatusIndicator";
import {
  ConflictError,
  removeItemPhotoRequest,
  uploadItemPhotoRequest,
  type Item,
} from "@/lib/api/items-client";
import { ACCEPT_ATTRIBUTE, MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from "@/lib/uploads/limits";

const MUTED = "color-mix(in srgb, var(--color-text) 55%, transparent)";

/**
 * The item's cover, doubling as its upload target — for items whose metadata
 * lookup came back without a cover (or where the physical copy differs from the
 * catalogue art), a photo of the thing on the shelf is the fallback.
 */
export function CoverPhoto({
  collectionId,
  item,
  canEdit,
  plate,
  onItemUpdate,
  onStatusChange,
}: {
  collectionId: string;
  item: Item;
  canEdit: boolean;
  plate: string;
  onItemUpdate: (item: Item) => void;
  onStatusChange: (status: SaveStatus) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState<"upload" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(kind: "upload" | "remove", work: () => Promise<Item>) {
    setBusy(kind);
    setError(null);
    onStatusChange({ kind: "saving" });
    try {
      onItemUpdate(await work());
      onStatusChange({ kind: "saved", at: new Date() });
    } catch (err) {
      if (err instanceof ConflictError) {
        onItemUpdate(err.current);
        setError("This item changed elsewhere — reloaded it. Try again.");
      } else {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      }
      onStatusChange({ kind: "error" });
    } finally {
      setBusy(null);
    }
  }

  // Cheap client-side rejection so obvious mistakes don't cost an upload; the
  // route sniffs the bytes regardless of what the browser claims here.
  function handleFile(file: File) {
    if (!file.type.startsWith("image/")) {
      setError("That's not an image file.");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(`That photo is ${(file.size / 1024 / 1024).toFixed(1)}MB — the cap is ${MAX_UPLOAD_MB}MB.`);
      return;
    }
    run("upload", () => uploadItemPhotoRequest(collectionId, item.id, file, item.updatedAt));
  }

  function handleRemove() {
    run("remove", () => removeItemPhotoRequest(collectionId, item.id, item.updatedAt));
  }

  const interactive = canEdit && busy === null;

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <Blueprint
        className="duotone"
        style={{
          aspectRatio: "3/4",
          background: item.coverUrl ? undefined : dragOver ? "var(--color-accent-100)" : plate,
          borderStyle: canEdit && !item.coverUrl ? "dashed" : undefined,
          display: "grid",
          placeItems: "stretch",
          padding: 0,
          overflow: "hidden",
          cursor: interactive ? "pointer" : "default",
          opacity: busy ? 0.6 : 1,
          outline: dragOver ? "2px solid var(--color-accent)" : undefined,
          outlineOffset: -2,
        }}
        onClick={() => interactive && inputRef.current?.click()}
      >
        {/* A real box (not display:contents) so it can be a drop target. */}
        <div
          style={{
            display: "grid",
            placeItems: item.coverUrl ? "stretch" : "end start",
            padding: item.coverUrl ? 0 : 14,
            minWidth: 0,
          }}
          onDragOver={(e) => {
            if (!interactive) return;
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            if (!interactive) return;
            e.preventDefault();
            setDragOver(false);
            const file = e.dataTransfer.files?.[0];
            if (file) handleFile(file);
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT_ATTRIBUTE}
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              // Reset so re-picking the same file still fires a change event.
              e.target.value = "";
              if (file) handleFile(file);
            }}
          />
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
              {busy === "upload" ? "Uploading…" : canEdit ? "Drop a photo" : "Cover"}
            </span>
          )}
        </div>
      </Blueprint>

      {canEdit && (
        <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ fontSize: 12 }}
            disabled={busy !== null}
            onClick={() => inputRef.current?.click()}
          >
            {busy === "upload" ? "Uploading…" : item.coverUrl ? "Replace photo" : "Upload a photo"}
          </button>
          {item.coverUrl && (
            <button
              type="button"
              className="btn btn-ghost"
              style={{ fontSize: 12, color: "var(--color-accent-700)" }}
              disabled={busy !== null}
              onClick={handleRemove}
            >
              {busy === "remove" ? "Removing…" : "Remove"}
            </button>
          )}
        </div>
      )}

      {error ? (
        <div style={{ fontSize: 11.5, color: "#b5544a", lineHeight: 1.4 }}>{error}</div>
      ) : (
        canEdit && (
          <div style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.4 }}>
            JPEG, PNG, WebP, GIF or AVIF · up to {MAX_UPLOAD_MB}MB. Resized and stripped of
            camera data on upload. Use this when the lookup doesn&rsquo;t have art for your copy.
          </div>
        )
      )}
    </div>
  );
}
