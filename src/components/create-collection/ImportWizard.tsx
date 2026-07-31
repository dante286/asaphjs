"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Blueprint } from "@/components/ui/Blueprint";
import { CsvDropzone } from "@/components/create-collection/CsvDropzone";
import { importCsvIntoCollectionAction, rollbackImportBatchAction } from "@/actions/imports";
import { guessColumnType } from "@/lib/fields/type-guess";
import { slugifyFieldLabel, type FieldDef } from "@/lib/fields/field-def";
import type { ParsedCsv } from "@/lib/csv/parse";

const SKIP = "__skip";
const NEW = "__new";

export function ImportWizard({
  collectionSlug,
  collectionId,
  existingFields,
  savedMapping,
}: {
  collectionSlug: string;
  collectionId: string;
  existingFields: FieldDef[];
  savedMapping: Record<string, string>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [csv, setCsv] = useState<ParsedCsv | null>(null);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ batchId: string; inserted: number; errors: { row: number; message: string }[] } | null>(null);

  function handleParsed(parsed: ParsedCsv) {
    setCsv(parsed);
    setResult(null);
    const initial: Record<string, string> = {};
    for (const header of parsed.headers) {
      if (savedMapping[header] && (existingFields.some((f) => f.id === savedMapping[header]) || savedMapping[header] === SKIP)) {
        initial[header] = savedMapping[header];
        continue;
      }
      const existingMatch = existingFields.find((f) => f.label.toLowerCase() === header.toLowerCase());
      initial[header] = existingMatch ? existingMatch.id : NEW;
    }
    setChoices(initial);
  }

  const finalFields = useMemo(() => {
    if (!csv) return existingFields;
    const fields = [...existingFields];
    for (const header of csv.headers) {
      if (choices[header] !== NEW) continue;
      const id = slugifyFieldLabel(header);
      if (fields.some((f) => f.id === id)) continue;
      const samples = csv.rows.slice(0, 50).map((r) => r[header] ?? "");
      fields.push({
        id,
        label: header,
        type: guessColumnType(samples),
        order: fields.length,
        origin: "csv",
        showInTable: true,
      });
    }
    return fields;
  }, [csv, choices, existingFields]);

  function commit() {
    if (!csv) return;
    setError(null);
    const mapping = Object.fromEntries(
      csv.headers.map((header) => {
        const choice = choices[header];
        if (choice === NEW) {
          const field = finalFields.find((f) => f.label === header && f.origin === "csv");
          return [header, field?.id ?? SKIP];
        }
        return [header, choice];
      }),
    );

    startTransition(async () => {
      try {
        const res = await importCsvIntoCollectionAction({
          collectionId,
          fields: finalFields,
          mapping,
          rows: csv.rows,
        });
        setResult(res);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Import failed.");
      }
    });
  }

  function rollback() {
    if (!result) return;
    startTransition(async () => {
      await rollbackImportBatchAction(collectionId, result.batchId);
      setResult(null);
      setCsv(null);
      router.refresh();
    });
  }

  if (result) {
    return (
      <Blueprint style={{ padding: "18px 20px", marginTop: 20 }}>
        <div style={{ fontFamily: "var(--font-heading)", fontSize: 18, marginBottom: 6 }}>
          Imported {result.inserted} item{result.inserted === 1 ? "" : "s"}
        </div>
        {result.errors.length > 0 && (
          <div style={{ fontSize: 13, marginBottom: 10 }}>
            {result.errors.length} row{result.errors.length === 1 ? "" : "s"} skipped:
            <ul>
              {result.errors.slice(0, 10).map((e) => (
                <li key={e.row}>
                  Row {e.row}: {e.message}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-primary" onClick={() => router.push(`/collections/${collectionSlug}`)} type="button">
            View collection
          </button>
          <button className="btn btn-secondary" onClick={rollback} disabled={isPending} type="button">
            {isPending ? "Rolling back…" : "Undo this import"}
          </button>
        </div>
      </Blueprint>
    );
  }

  return (
    <div style={{ marginTop: 20 }}>
      <CsvDropzone onParsed={handleParsed} />

      {csv && (
        <Blueprint style={{ marginTop: 20, padding: "16px 18px" }}>
          <div style={{ fontFamily: "var(--font-heading)", fontSize: 16, marginBottom: 10 }}>
            Map columns · {csv.rows.length} rows
          </div>
          <div style={{ display: "grid", gap: 1 }}>
            {csv.headers.map((header) => (
              <div
                key={header}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 0",
                  borderBottom: "1px solid color-mix(in srgb, var(--color-text) 8%, transparent)",
                  fontSize: 13.5,
                }}
              >
                <span>{header}</span>
                <select
                  className="input"
                  value={choices[header] ?? NEW}
                  onChange={(e) => setChoices((prev) => ({ ...prev, [header]: e.target.value }))}
                  style={{ width: 220 }}
                >
                  <option value={NEW}>Create new field</option>
                  <option value={SKIP}>Skip this column</option>
                  {existingFields.map((f) => (
                    <option key={f.id} value={f.id}>
                      Map to &ldquo;{f.label}&rdquo;
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          {error && <div style={{ marginTop: 12, fontSize: 12.5, color: "#b5544a" }}>{error}</div>}

          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <button className="btn btn-primary" onClick={commit} disabled={isPending} type="button">
              {isPending ? "Importing…" : `Import ${csv.rows.length} rows`}
            </button>
          </div>
        </Blueprint>
      )}
    </div>
  );
}
