"use client";

import { useState } from "react";
import { Blueprint } from "@/components/ui/Blueprint";
import { MAX_CSV_BYTES, MAX_CSV_MB, csvTooLargeMessage } from "@/lib/csv/limits";
import { parseCsvText, type ParsedCsv } from "@/lib/csv/parse";

export function CsvDropzone({ onParsed }: { onParsed: (csv: ParsedCsv, fileName: string) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  async function handleFile(file: File) {
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setError("Please choose a .csv file.");
      return;
    }
    // Checked before reading, so an oversized file is never parsed or sent.
    if (file.size > MAX_CSV_BYTES) {
      setError(csvTooLargeMessage(file.size));
      return;
    }
    try {
      const text = await file.text();
      const parsed = parseCsvText(text);
      if (parsed.headers.length === 0) {
        setError("Couldn't find any columns in that file.");
        return;
      }
      setError(null);
      onParsed(parsed, file.name);
    } catch {
      setError("Couldn't read that file.");
    }
  }

  return (
    // A <label> around the file input, so clicking anywhere opens the picker and
    // the input itself takes keyboard focus (Enter or Space opens it). Visually
    // hidden rather than `hidden`, which would also take it out of the tab order.
    <Blueprint
      as="label"
      className="csv-dropzone"
      style={{
        display: "block",
        marginTop: 16,
        padding: 16,
        borderStyle: "dashed",
        textAlign: "center",
        cursor: "pointer",
        background: dragOver ? "var(--color-accent-100)" : undefined,
      }}
    >
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files?.[0];
          if (file) handleFile(file);
        }}
      >
        <input
          type="file"
          accept=".csv,text/csv"
          className="visually-hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            // So picking the same file again still fires a change.
            e.target.value = "";
          }}
        />
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ margin: "0 auto 6px", color: "var(--color-accent)" }}>
          <path d="M12 16V4"></path>
          <path d="m7 9 5-5 5 5"></path>
          <path d="M4 20h16"></path>
        </svg>
        <div style={{ fontFamily: "var(--font-heading)", fontSize: 15 }}>Start from a CSV</div>
        <div style={{ fontSize: 11.5, color: "color-mix(in srgb, var(--color-text) 60%, transparent)", marginTop: 2 }}>
          Drop a file or click to browse. Its headers become the collection&rsquo;s fields, with
          types guessed per column. Up to {MAX_CSV_MB} MB.
        </div>
        {error && (
          <div role="alert" style={{ fontSize: 11.5, color: "#b5544a", marginTop: 6 }}>
            {error}
          </div>
        )}
      </div>
    </Blueprint>
  );
}
