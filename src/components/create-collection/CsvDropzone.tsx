"use client";

import { useRef, useState } from "react";
import { Blueprint } from "@/components/ui/Blueprint";
import { parseCsvText, type ParsedCsv } from "@/lib/csv/parse";

export function CsvDropzone({ onParsed }: { onParsed: (csv: ParsedCsv, fileName: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  async function handleFile(file: File) {
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setError("Please choose a .csv file.");
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
    <Blueprint
      style={{
        marginTop: 16,
        padding: 16,
        borderStyle: "dashed",
        textAlign: "center",
        cursor: "pointer",
        background: dragOver ? "var(--color-accent-100)" : undefined,
      }}
      onClick={() => inputRef.current?.click()}
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
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
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
          types guessed per column.
        </div>
        {error && <div style={{ fontSize: 11.5, color: "#b5544a", marginTop: 6 }}>{error}</div>}
      </div>
    </Blueprint>
  );
}
