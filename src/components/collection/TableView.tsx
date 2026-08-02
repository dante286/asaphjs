"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FieldDef } from "@/lib/fields/field-def";
import { isTitleField } from "@/lib/fields/item-values";
import { FieldCell } from "@/components/collection/FieldCell";
import type { Item } from "@/lib/api/items-client";

const MIN_COLUMN_WIDTH = 72;
const MOBILE_BREAKPOINT = 640;

export function defaultColumnWidth(index: number): number {
  return index === 0 ? 230 : 132;
}

// On narrow screens, collapse to just the title and its card field (e.g.
// Console for Video Games) instead of a horizontally-scrolling full table.
function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`);
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  return isMobile;
}

export function TableView({
  items,
  fields,
  canEdit,
  columnWidths,
  hiddenColumns,
  onFieldChange,
  onDelete,
  onOpenItem,
  onResizeColumn,
  onResizeColumnEnd,
  onAutoFitColumn,
  rowCountLabel,
}: {
  items: Item[];
  fields: FieldDef[];
  canEdit: boolean;
  columnWidths: Record<string, number>;
  hiddenColumns: string[];
  onFieldChange: (item: Item, field: FieldDef, index: number, value: unknown) => void;
  onDelete: (item: Item) => void;
  onOpenItem: (item: Item) => void;
  onResizeColumn: (fieldId: string, width: number) => void;
  onResizeColumnEnd: (fieldId: string, width: number) => void;
  onAutoFitColumn: (fieldId: string) => void;
  rowCountLabel: string;
}) {
  const isMobile = useIsMobile();

  const columns = fields
    .map((field, index) => ({ field, index }))
    .filter(({ field, index }) => {
      if (hiddenColumns.includes(field.id)) return false;
      if (isMobile) return isTitleField(index) || field.showOnCard;
      return isTitleField(index) || field.showInTable;
    });

  const width = (fieldId: string, index: number) => columnWidths[fieldId] ?? defaultColumnWidth(index);
  const tableWidth = columns.reduce((sum, { field, index }) => sum + width(field.id, index), 0) + (canEdit ? 70 : 0);

  return (
    <div className="blueprint" style={{ padding: "6px 14px 10px", overflowX: "auto" }}>
      <i className="corner tl" />
      <i className="corner tr" />
      <i className="corner bl" />
      <i className="corner br" />
      <table className="table" style={{ tableLayout: "fixed", width: tableWidth }}>
        <thead>
          <tr>
            {columns.map(({ field, index }) => (
              <th
                key={field.id}
                style={{
                  width: width(field.id, index),
                  position: "relative",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  paddingRight: 14,
                }}
              >
                {field.label}
                <ResizeHandle
                  active={columnWidths[field.id] !== undefined}
                  onResize={(w) => onResizeColumn(field.id, w)}
                  onResizeEnd={(w) => onResizeColumnEnd(field.id, w)}
                  onAutoFit={() => onAutoFitColumn(field.id)}
                  startWidth={width(field.id, index)}
                />
              </th>
            ))}
            {canEdit && <th style={{ width: 70 }}></th>}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              {columns.map(({ field, index }) => (
                <td key={field.id} style={{ verticalAlign: "middle", overflow: "hidden" }}>
                  {isTitleField(index) ? (
                    <button
                      type="button"
                      onClick={() => onOpenItem(item)}
                      style={{
                        display: "block",
                        fontFamily: "var(--font-heading)",
                        fontSize: 15,
                        padding: "4px 6px",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        width: "100%",
                        textAlign: "left",
                        background: "transparent",
                        border: 0,
                        cursor: "pointer",
                        color: "inherit",
                      }}
                    >
                      {item.title}
                    </button>
                  ) : (
                    <FieldCell
                      item={item}
                      field={field}
                      index={index}
                      disabled={!canEdit}
                      onChange={(value) => onFieldChange(item, field, index, value)}
                    />
                  )}
                </td>
              ))}
              {canEdit && (
                <td>
                  <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => onDelete(item)} type="button">
                    Delete
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "12px 6px 4px",
          fontSize: 11.5,
          color: "color-mix(in srgb, var(--color-text) 55%, transparent)",
        }}
      >
        <span>Every edit saves on change. Drag a column edge to resize, double-click it to fit — layout is remembered per collection.</span>
        <span>{rowCountLabel}</span>
      </div>
    </div>
  );
}

function ResizeHandle({
  active,
  startWidth,
  onResize,
  onResizeEnd,
  onAutoFit,
}: {
  active: boolean;
  startWidth: number;
  onResize: (width: number) => void;
  onResizeEnd: (width: number) => void;
  onAutoFit: () => void;
}) {
  const dragState = useRef<{ startX: number; startWidth: number; lastWidth: number } | null>(null);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragState.current = { startX: e.clientX, startWidth, lastWidth: startWidth };

      const move = (ev: MouseEvent) => {
        if (!dragState.current) return;
        const w = Math.max(MIN_COLUMN_WIDTH, Math.round(dragState.current.startWidth + ev.clientX - dragState.current.startX));
        dragState.current.lastWidth = w;
        onResize(w);
      };
      const up = () => {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
        document.body.style.cursor = "";
        if (dragState.current) onResizeEnd(dragState.current.lastWidth);
        dragState.current = null;
      };
      document.body.style.cursor = "col-resize";
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    },
    [onResize, onResizeEnd, startWidth],
  );

  return (
    <span
      onMouseDown={handleMouseDown}
      onDoubleClick={onAutoFit}
      title="Drag to resize · double-click to fit"
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        width: 11,
        height: "100%",
        cursor: "col-resize",
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
        paddingRight: 3,
      }}
    >
      <span
        style={{
          width: 1,
          height: "58%",
          background: active ? "var(--color-accent)" : "color-mix(in srgb, var(--color-text) 28%, transparent)",
        }}
      />
    </span>
  );
}
