"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Blueprint } from "@/components/ui/Blueprint";
import { Tag } from "@/components/ui/Tag";
import { CsvDropzone } from "@/components/create-collection/CsvDropzone";
import { createCollectionAction } from "@/actions/collections";
import { importCsvIntoNewCollectionAction } from "@/actions/imports";
import { FIELD_TYPES, slugifyFieldLabel, type FieldDef, type FieldType } from "@/lib/fields/field-def";
import { guessFieldsFromRows } from "@/lib/fields/type-guess";
import type { ParsedCsv } from "@/lib/csv/parse";

type TemplateOption = {
  key: string;
  name: string;
  fields: FieldDef[];
};

const BLANK_TEMPLATE: TemplateOption = {
  key: "blank",
  name: "Blank",
  fields: [{ id: "title", label: "Title", type: "text", order: 0, origin: "template" }],
};

export function CreateCollectionWizard({ templates }: { templates: TemplateOption[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const allTemplates = useMemo(
    () => (templates.some((t) => t.key === BLANK_TEMPLATE.key) ? templates : [...templates, BLANK_TEMPLATE]),
    [templates],
  );

  const [templateKey, setTemplateKey] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [fields, setFields] = useState<FieldDef[]>([]);
  const [draftFieldName, setDraftFieldName] = useState("");
  const [draftFieldType, setDraftFieldType] = useState<FieldType>("text");
  const [trackVerified, setTrackVerified] = useState(true);
  const [trackLending, setTrackLending] = useState(true);
  const [defaultView, setDefaultView] = useState<"covers" | "table">("covers");
  const [error, setError] = useState<string | null>(null);
  const [csv, setCsv] = useState<ParsedCsv | null>(null);

  function pickTemplate(t: TemplateOption) {
    setTemplateKey(t.key);
    setCsv(null);
    setName((prev) => prev || t.name);
    setFields(t.fields.map((f) => ({ ...f })));
  }

  function handleCsvParsed(parsed: ParsedCsv, fileName: string) {
    setTemplateKey(null);
    setCsv(parsed);
    setName((prev) => prev || fileName.replace(/\.csv$/i, ""));
    setFields(guessFieldsFromRows(parsed.headers, parsed.rows));
  }

  function removeField(id: string) {
    setFields((prev) => prev.filter((f) => f.id !== id));
  }

  function addField() {
    if (!draftFieldName.trim()) return;
    const id = slugifyFieldLabel(draftFieldName);
    if (fields.some((f) => f.id === id)) {
      setError(`A field named "${draftFieldName}" already exists.`);
      return;
    }
    setError(null);
    setFields((prev) => [
      ...prev,
      {
        id,
        label: draftFieldName.trim(),
        type: draftFieldType,
        order: prev.length,
        origin: "custom",
        showInTable: draftFieldType !== "longtext" && draftFieldType !== "image",
      },
    ]);
    setDraftFieldName("");
    setDraftFieldType("text");
  }

  function submit() {
    if (!name.trim()) {
      setError("Give the collection a name.");
      return;
    }
    if (fields.length === 0) {
      setError("Add at least one field.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        if (csv) {
          const mapping = Object.fromEntries(
            csv.headers.map((header) => {
              const field = fields.find((f) => f.label === header);
              return [header, field ? field.id : "__skip"];
            }),
          );
          await importCsvIntoNewCollectionAction({
            name: name.trim(),
            fields,
            mapping,
            rows: csv.rows,
            defaultView,
            features: { verified: trackVerified, lending: trackLending },
          });
        } else {
          await createCollectionAction({
            name: name.trim(),
            templateKey,
            fields,
            defaultView,
            features: { verified: trackVerified, lending: trackLending },
          });
        }
      } catch (err) {
        // redirect() signals success by throwing a NEXT_REDIRECT-digest error
        // that Next's runtime needs to see propagate — anything else is real.
        const digest = (err as { digest?: unknown })?.digest;
        if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) throw err;
        setError(err instanceof Error ? err.message : "Couldn't create the collection.");
      }
    });
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: "clamp(18px,2.6vw,32px)", marginTop: 26, alignItems: "start" }}>
      <div>
        <h6 style={{ marginBottom: 10 }}>1 · Template</h6>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))", gap: 8 }}>
          {allTemplates.map((t) => {
            const active = templateKey === t.key;
            return (
              <Blueprint
                key={t.key}
                style={{
                  padding: "10px 12px",
                  cursor: "pointer",
                  background: active ? "var(--color-accent-200)" : undefined,
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                }}
                onClick={() => pickTemplate(t)}
              >
                <span style={{ fontFamily: "var(--font-heading)", fontSize: 15, color: active ? "var(--color-accent-900)" : undefined }}>
                  {t.name}
                </span>
                <span style={{ fontSize: 10.5, color: active ? "var(--color-accent-800)" : "color-mix(in srgb, var(--color-text) 55%, transparent)" }}>
                  {t.fields.length} field{t.fields.length === 1 ? "" : "s"}
                </span>
              </Blueprint>
            );
          })}
        </div>
        <CsvDropzone onParsed={handleCsvParsed} />
        {csv && (
          <div style={{ marginTop: 8, fontSize: 11.5, color: "var(--color-accent-700)" }}>
            Loaded {csv.rows.length} row{csv.rows.length === 1 ? "" : "s"} from {csv.headers.length}{" "}
            column{csv.headers.length === 1 ? "" : "s"} — review the guessed field types at right.
          </div>
        )}
      </div>

      <div>
        <h6 style={{ marginBottom: 10 }}>2 · Fields</h6>
        <Blueprint style={{ padding: "16px 18px" }}>
          <div className="field" style={{ marginBottom: 14 }}>
            <label>Collection name</label>
            <input className="input" type="text" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div style={{ display: "grid", gap: 1, borderTop: "1px solid var(--color-divider)" }}>
            {fields.map((f, index) => (
              <div
                key={f.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto auto",
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
                  {index === 0 && <Tag variant="neutral">Title field</Tag>}
                </span>
                <Tag variant="neutral">{f.type}</Tag>
                {index === 0 ? (
                  <span />
                ) : (
                  <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => removeField(f.id)} type="button">
                    Remove
                  </button>
                )}
              </div>
            ))}
            {fields.length === 0 && (
              <div style={{ padding: "10px 0", fontSize: 13, opacity: 0.7 }}>
                Pick a template, or add fields directly below.
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
            <input
              className="input"
              type="text"
              placeholder="New field name"
              value={draftFieldName}
              onChange={(e) => setDraftFieldName(e.target.value)}
              style={{ flex: "1 1 150px" }}
            />
            <select
              className="input"
              value={draftFieldType}
              onChange={(e) => setDraftFieldType(e.target.value as FieldType)}
              style={{ flex: "0 1 150px" }}
            >
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
        </Blueprint>

        <h6 style={{ margin: "20px 0 10px" }}>3 · Options</h6>
        <Blueprint style={{ padding: "16px 18px", display: "grid", gap: 12, fontSize: 13.5 }}>
          <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer" }}>
            <input type="checkbox" checked={defaultView === "table"} onChange={(e) => setDefaultView(e.target.checked ? "table" : "covers")} style={{ marginTop: 3 }} />
            <span>
              <span style={{ display: "block" }}>Default to table view</span>
              <span style={{ fontSize: 11.5, color: "color-mix(in srgb, var(--color-text) 55%, transparent)" }}>
                Otherwise the collection opens in covers view.
              </span>
            </span>
          </label>
          <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer" }}>
            <input type="checkbox" checked={trackVerified} onChange={(e) => setTrackVerified(e.target.checked)} style={{ marginTop: 3 }} />
            <span>
              <span style={{ display: "block" }}>Track verified / collector status</span>
              <span style={{ fontSize: 11.5, color: "color-mix(in srgb, var(--color-text) 55%, transparent)" }}>
                Shows a verified count in the dashboard and stats.
              </span>
            </span>
          </label>
          <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer" }}>
            <input type="checkbox" checked={trackLending} onChange={(e) => setTrackLending(e.target.checked)} style={{ marginTop: 3 }} />
            <span>
              <span style={{ display: "block" }}>Track lending</span>
              <span style={{ fontSize: 11.5, color: "color-mix(in srgb, var(--color-text) 55%, transparent)" }}>
                Adds a borrower field to every item.
              </span>
            </span>
          </label>
        </Blueprint>

        {error && <div style={{ marginTop: 12, fontSize: 12.5, color: "#b5544a" }}>{error}</div>}

        <div style={{ display: "flex", gap: 10, marginTop: 18, flexWrap: "wrap" }}>
          <button className="btn btn-primary" style={{ height: 42, paddingInline: 20 }} onClick={submit} disabled={isPending}>
            {isPending ? "Creating…" : "Create collection"}
          </button>
          <button className="btn btn-secondary" style={{ height: 42 }} onClick={() => router.push("/")} type="button">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
