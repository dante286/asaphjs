"use client";

import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Blueprint } from "@/components/ui/Blueprint";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { SaveStatusIndicator, type SaveStatus } from "@/components/collection/SaveStatusIndicator";
import { CoversView } from "@/components/collection/CoversView";
import { TableView } from "@/components/collection/TableView";
import {
  ConflictError,
  createItemRequest,
  deleteItemRequest,
  fetchItems,
  patchItemRequest,
  type Item,
  type ItemsPage,
} from "@/lib/api/items-client";
import { buildPatchForField } from "@/lib/fields/item-values";
import type { FieldDef } from "@/lib/fields/field-def";

const DEBOUNCED_TYPES = new Set(["text", "longtext", "number", "url", "currency", "tags"]);
const DEBOUNCE_MS = 400;

export function ItemsExplorer({
  collectionId,
  fields,
  canEdit,
  defaultView,
  initialData,
}: {
  collectionId: string;
  fields: FieldDef[];
  canEdit: boolean;
  defaultView: "covers" | "table";
  initialData: ItemsPage;
}) {
  const queryClient = useQueryClient();
  const [view, setView] = useState<"covers" | "table">(defaultView);
  const [q, setQ] = useState("");
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [lentOnly, setLentOnly] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ kind: "idle" });
  const debounceTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const queryKey = ["items", collectionId, { q, verifiedOnly, lentOnly }] as const;

  const { data } = useQuery({
    queryKey,
    queryFn: () => fetchItems(collectionId, { q, verifiedOnly, lentOnly }),
    initialData: !q && !verifiedOnly && !lentOnly ? initialData : undefined,
    placeholderData: (prev) => prev,
  });

  const items = data?.rows ?? [];

  const patchMutation = useMutation({
    mutationFn: async ({ item, patch }: { item: Item; patch: ReturnType<typeof buildPatchForField> }) =>
      patchItemRequest(collectionId, item.id, patch, item.updatedAt),
    onMutate: async ({ item, patch }) => {
      setSaveStatus({ kind: "saving" });
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<ItemsPage>(queryKey);
      queryClient.setQueryData<ItemsPage | undefined>(queryKey, (old) =>
        old
          ? {
              ...old,
              rows: old.rows.map((row) =>
                row.id === item.id ? { ...row, ...(patch as Partial<Item>), values: { ...row.values, ...(patch.values ?? {}) } } : row,
              ),
            }
          : old,
      );
      return { previous };
    },
    onError: (err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
      if (err instanceof ConflictError) {
        queryClient.setQueryData<ItemsPage | undefined>(queryKey, (old) =>
          old
            ? { ...old, rows: old.rows.map((row) => (row.id === err.current.id ? (err.current as unknown as Item) : row)) }
            : old,
        );
      }
      setSaveStatus({ kind: "error" });
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<ItemsPage | undefined>(queryKey, (old) =>
        old ? { ...old, rows: old.rows.map((row) => (row.id === updated.id ? updated : row)) } : old,
      );
      setSaveStatus({ kind: "saved", at: new Date() });
    },
  });

  const createMutation = useMutation({
    mutationFn: (title: string) => createItemRequest(collectionId, title),
    onSuccess: (item) => {
      queryClient.setQueryData<ItemsPage | undefined>(queryKey, (old) =>
        old ? { ...old, rows: [item, ...old.rows], total: old.total + 1 } : old,
      );
      setView("table");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (item: Item) => deleteItemRequest(collectionId, item.id),
    onMutate: async (item) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<ItemsPage>(queryKey);
      queryClient.setQueryData<ItemsPage | undefined>(queryKey, (old) =>
        old ? { ...old, rows: old.rows.filter((r) => r.id !== item.id), total: old.total - 1 } : old,
      );
      return { previous };
    },
    onError: (_err, _item, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
    },
  });

  function handleFieldChange(item: Item, field: FieldDef, index: number, value: unknown) {
    const patch = buildPatchForField(field, index, value);
    const key = `${item.id}:${field.id}`;

    if (DEBOUNCED_TYPES.has(field.type)) {
      const existing = debounceTimers.current.get(key);
      if (existing) clearTimeout(existing);
      debounceTimers.current.set(
        key,
        setTimeout(() => {
          patchMutation.mutate({ item, patch });
          debounceTimers.current.delete(key);
        }, DEBOUNCE_MS),
      );
    } else {
      patchMutation.mutate({ item, patch });
    }
  }

  const rowCountLabel = useMemo(() => {
    const total = data?.total ?? 0;
    return `${total} item${total === 1 ? "" : "s"}`;
  }, [data?.total]);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <SegmentedControl
            name="view"
            value={view}
            onChange={setView}
            options={[
              { value: "covers", label: "Covers" },
              { value: "table", label: "Table" },
            ]}
          />
          <Blueprint style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ opacity: 0.55 }}>
              <circle cx="11" cy="11" r="7"></circle>
              <path d="m20 20-3.5-3.5"></path>
            </svg>
            <input
              type="text"
              placeholder="Filter this collection"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={{ border: 0, background: "transparent", font: "inherit", fontSize: 13, outline: "none", width: "min(210px,40vw)", color: "inherit" }}
            />
          </Blueprint>
          <button
            type="button"
            className={verifiedOnly ? "tag tag-accent" : "tag tag-neutral"}
            style={{ cursor: "pointer", border: "none" }}
            onClick={() => setVerifiedOnly((v) => !v)}
          >
            Verified only
          </button>
          <button
            type="button"
            className={lentOnly ? "tag tag-accent" : "tag tag-neutral"}
            style={{ cursor: "pointer", border: "none" }}
            onClick={() => setLentOnly((v) => !v)}
          >
            Lent out
          </button>
          {canEdit && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                const title = window.prompt("Title for the new item?");
                if (title?.trim()) createMutation.mutate(title.trim());
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M12 5v14"></path>
                <path d="M5 12h14"></path>
              </svg>
              Add item
            </button>
          )}
        </div>
        <SaveStatusIndicator status={saveStatus} />
      </div>

      {view === "covers" ? (
        <CoversView items={items} fields={fields} onOpenItem={() => setView("table")} />
      ) : (
        <TableView
          items={items}
          fields={fields}
          canEdit={canEdit}
          onFieldChange={handleFieldChange}
          onDelete={(item) => deleteMutation.mutate(item)}
          rowCountLabel={rowCountLabel}
        />
      )}
    </div>
  );
}
