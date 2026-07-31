"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Blueprint } from "@/components/ui/Blueprint";
import { Tag } from "@/components/ui/Tag";
import { updateFieldsAction } from "@/actions/collections";
import { FIELD_TYPES, slugifyFieldLabel, type FieldDef, type FieldType } from "@/lib/fields/field-def";

export function FieldsEditor({
  collectionId,
  collectionSlug,
  initialFields,
}: {
  collectionId: string;
  collectionSlug: string;
  initialFields: FieldDef[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [fields, setFields] = useState<FieldDef[]>(initialFields);
  const [draftName, setDraftName] = useState("");
  const [draftType, setDraftType] = useState<FieldType>("text");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function removeField(id: string) {
    setFields((prev) => prev.filter((f) => f.id !== id));
    setSaved(false);
  }

  function toggleShowInTable(id: string) {
    setFields((prev) => prev.map((f) => (f.id === id ? { ...f, showInTable: !f.showInTable } : f)));
    setSaved(false);
  }

  function addField() {
    if (!draftName.trim()) return;
    const id = slugifyFieldLabel(draftName);
    if (fields.some((f) => f.id === id)) {
      setError(`A field named "${draftName}" already exists.`);
      return;
    }
    setError(null);
    setFields((prev) => [
      ...prev,
      {
        id,
        label: draftName.trim(),
        type: draftType,
        order: prev.length,
        origin: "custom",
        showInTable: draftType !== "longtext" && draftType !== "image",
      },
    ]);
    setDraftName("");
    setDraftType("text");
    setSaved(false);
  }

  function save() {
    setError(null);
    startTransition(async () => {
      try {
        await updateFieldsAction(collectionId, fields.map((f, index) => ({ ...f, order: index })));
        setSaved(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't save fields.");
      }
    });
  }

  return (
    <Blueprint style={{ padding: "16px 18px", marginTop: 20 }}>
      <div style={{ display: "grid", gap: 1, borderTop: "1px solid var(--color-divider)" }}>
        {fields.map((f, index) => (
          <div
            key={f.id}
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto auto auto",
              alignItems: "center",
              gap: 10,
              padding: "8px 0",
              borderBottom: "1px solid color-mix(in srgb, var(--color-text) 8%, transparent)",
              fontSize: 13.5,
            }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {f.label}
              {f.origin === "custom" && <Tag variant="accent">Custom</Tag>}
              {f.origin === "csv" && <Tag variant="accent-2">CSV</Tag>}
              {index === 0 && <Tag variant="neutral">Title field</Tag>}
            </span>
            <Tag variant="neutral">{f.type}</Tag>
            {index === 0 ? (
              <span />
            ) : (
              <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}>
                <input type="checkbox" checked={Boolean(f.showInTable)} onChange={() => toggleShowInTable(f.id)} />
                In table
              </label>
            )}
            {index === 0 ? (
              <span />
            ) : (
              <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => removeField(f.id)} type="button">
                Remove
              </button>
            )}
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
        <input
          className="input"
          type="text"
          placeholder="New field name"
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          style={{ flex: "1 1 150px" }}
        />
        <select className="input" value={draftType} onChange={(e) => setDraftType(e.target.value as FieldType)} style={{ flex: "0 1 150px" }}>
          {FIELD_TYPES.map((ft) => (
            <option key={ft} value={ft}>
              {ft}
            </option>
          ))}
        </select>
        <button className="btn btn-secondary" type="button" onClick={addField}>
          Add field
        </button>
      </div>

      {error && <div style={{ marginTop: 12, fontSize: 12.5, color: "#b5544a" }}>{error}</div>}

      <div style={{ display: "flex", gap: 10, marginTop: 18, alignItems: "center" }}>
        <button className="btn btn-primary" onClick={save} disabled={isPending} type="button">
          {isPending ? "Saving…" : "Save fields"}
        </button>
        <button className="btn btn-secondary" onClick={() => router.push(`/collections/${collectionSlug}`)} type="button">
          Back to collection
        </button>
        {saved && <span style={{ fontSize: 12, color: "var(--color-accent-700)" }}>Saved.</span>}
      </div>
    </Blueprint>
  );
}
