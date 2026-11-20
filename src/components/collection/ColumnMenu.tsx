"use client";

import { useState } from "react";
import type { FieldDef } from "@/lib/fields/field-def";
import { isTitleField } from "@/lib/fields/item-values";

export function ColumnMenu({
  fields,
  hiddenColumns,
  onToggle,
  onShowAll,
  onResetWidths,
}: {
  fields: FieldDef[];
  hiddenColumns: string[];
  onToggle: (fieldId: string) => void;
  onShowAll: () => void;
  onResetWidths: () => void;
}) {
  const [open, setOpen] = useState(false);
  // Only the columns the table can show: a field set not to appear in the
  // table (Fields → "Show in table") isn't rendered whatever this menu says,
  // so listing it here as a checked box was a toggle that did nothing.
  const columns = fields
    .map((field, index) => ({ field, index }))
    .filter(({ field, index }) => isTitleField(index) || field.showInTable);
  const hiddenCount = columns.filter(({ field }) => hiddenColumns.includes(field.id)).length;
  const countLabel = hiddenCount ? `${columns.length - hiddenCount}/${columns.length}` : "";

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        className="btn btn-secondary"
        style={{ height: 32, fontSize: 12.5 }}
        onClick={() => setOpen((v) => !v)}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M3 4h18"></path>
          <path d="M9 4v16"></path>
          <path d="M15 4v16"></path>
          <path d="M3 20h18"></path>
        </svg>
        Columns {countLabel}
      </button>
      {open && (
        <>
          <div
            onClick={() => setOpen(false)}
            style={{ position: "fixed", inset: 0, zIndex: 19 }}
          />
          <div
            className="blueprint"
            style={{
              position: "absolute",
              right: 0,
              top: 38,
              zIndex: 20,
              background: "var(--color-bg)",
              padding: "12px 14px",
              minWidth: 220,
              boxShadow: "var(--shadow-lg)",
            }}
          >
            <i className="corner tl" />
            <i className="corner tr" />
            <i className="corner bl" />
            <i className="corner br" />
            <div
              style={{
                fontSize: 10,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: "color-mix(in srgb, var(--color-text) 55%, transparent)",
                marginBottom: 8,
              }}
            >
              Visible columns
            </div>
            <div style={{ display: "grid", gap: 7 }}>
              {columns.map(({ field, index }) => {
                const locked = isTitleField(index);
                const visible = locked || !hiddenColumns.includes(field.id);
                return (
                  <label
                    key={field.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 9,
                      fontSize: 13,
                      cursor: locked ? "not-allowed" : "pointer",
                      opacity: locked ? 0.55 : 1,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={visible}
                      disabled={locked}
                      onChange={() => onToggle(field.id)}
                      style={{ accentColor: "var(--color-accent)", width: 15, height: 15 }}
                    />
                    {field.label}
                  </label>
                );
              })}
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 8,
                marginTop: 12,
                paddingTop: 10,
                borderTop: "1px solid var(--color-divider)",
              }}
            >
              <button type="button" className="btn btn-ghost" style={{ fontSize: 12 }} onClick={onShowAll}>
                Show all
              </button>
              <button type="button" className="btn btn-ghost" style={{ fontSize: 12 }} onClick={onResetWidths}>
                Reset widths
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
