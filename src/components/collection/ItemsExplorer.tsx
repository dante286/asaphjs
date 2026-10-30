"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Blueprint } from "@/components/ui/Blueprint";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { SaveStatusIndicator, type SaveStatus } from "@/components/collection/SaveStatusIndicator";
import { CoversView } from "@/components/collection/CoversView";
import { TableView } from "@/components/collection/TableView";
import { ColumnMenu } from "@/components/collection/ColumnMenu";
import { CreateItemDialog } from "@/components/collection/CreateItemDialog";
import {
  ConflictError,
  createItemRequest,
  deleteItemRequest,
  fetchItems,
  patchItemRequest,
  type Item,
  type ItemDraft,
  type ItemsPage,
} from "@/lib/api/items-client";
import {
  firstPageData,
  flattenRows,
  mapRows,
  nextPageParam,
  prependRow,
  removeRow,
  totalOf,
  type ItemsPages,
} from "@/lib/api/items-pages";
import { fetchViewPrefs, saveViewPrefs, type ViewPrefs } from "@/lib/api/view-prefs-client";
import { buildPatchForField } from "@/lib/fields/item-values";
import type { FieldDef } from "@/lib/fields/field-def";
import type { LookupConfig } from "@/lib/metadata/lookup-config";

const DEBOUNCED_TYPES = new Set(["text", "longtext", "number", "url", "currency", "tags"]);
const DEBOUNCE_MS = 400;

export function ItemsExplorer({
  collectionId,
  collectionSlug,
  fields,
  canEdit,
  defaultView,
  initialData,
  initialViewPrefs,
  lookup,
}: {
  collectionId: string;
  collectionSlug: string;
  fields: FieldDef[];
  canEdit: boolean;
  defaultView: "covers" | "table";
  initialData: ItemsPage;
  initialViewPrefs: ViewPrefs;
  /** Resolved server-side; null when this collection has no metadata provider. */
  lookup: LookupConfig | null;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [view, setView] = useState<"covers" | "table">(defaultView);
  const [createOpen, setCreateOpen] = useState(false);
  const [q, setQ] = useState("");
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [lentOnly, setLentOnly] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ kind: "idle" });
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(initialViewPrefs.columnWidths);
  const [hiddenColumns, setHiddenColumns] = useState<string[]>(initialViewPrefs.hiddenColumns);
  const debounceTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const viewPrefsQueryKey = ["view-prefs", collectionId] as const;
  useQuery({
    queryKey: viewPrefsQueryKey,
    queryFn: () => fetchViewPrefs(collectionId),
    initialData: initialViewPrefs,
    staleTime: Infinity,
  });

  const viewPrefsMutation = useMutation({
    mutationFn: (patch: Parameters<typeof saveViewPrefs>[1]) => saveViewPrefs(collectionId, patch),
  });

  function openItem(item: Item) {
    router.push(`/collections/${collectionSlug}/items/${item.id}`);
  }

  function handleResizeColumn(fieldId: string, width: number) {
    setColumnWidths((prev) => ({ ...prev, [fieldId]: width }));
  }

  function handleResizeColumnEnd(fieldId: string, width: number) {
    setSaveStatus({ kind: "saving" });
    viewPrefsMutation.mutate(
      { columnWidths: { [fieldId]: width } },
      { onSuccess: () => setSaveStatus({ kind: "saved", at: new Date() }) },
    );
  }

  function handleAutoFitColumn(fieldId: string) {
    setColumnWidths((prev) => {
      const next = { ...prev };
      delete next[fieldId];
      return next;
    });
    setSaveStatus({ kind: "saving" });
    viewPrefsMutation.mutate(
      { columnWidths: { [fieldId]: null } },
      { onSuccess: () => setSaveStatus({ kind: "saved", at: new Date() }) },
    );
  }

  function handleToggleColumn(fieldId: string) {
    setHiddenColumns((prev) => {
      const next = prev.includes(fieldId) ? prev.filter((id) => id !== fieldId) : prev.concat(fieldId);
      viewPrefsMutation.mutate(
        { hiddenColumns: next },
        { onSuccess: () => setSaveStatus({ kind: "saved", at: new Date() }) },
      );
      return next;
    });
    setSaveStatus({ kind: "saving" });
  }

  function handleShowAllColumns() {
    setHiddenColumns([]);
    setSaveStatus({ kind: "saving" });
    viewPrefsMutation.mutate(
      { hiddenColumns: [] },
      { onSuccess: () => setSaveStatus({ kind: "saved", at: new Date() }) },
    );
  }

  function handleResetWidths() {
    setColumnWidths({});
    setSaveStatus({ kind: "saving" });
    viewPrefsMutation.mutate(
      { resetColumnWidths: true },
      { onSuccess: () => setSaveStatus({ kind: "saved", at: new Date() }) },
    );
  }

  const queryKey = ["items", collectionId, { q, verifiedOnly, lentOnly }] as const;

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery<ItemsPage, Error, ItemsPages, typeof queryKey, number>({
    queryKey,
    queryFn: ({ pageParam }) => fetchItems(collectionId, { q, verifiedOnly, lentOnly }, pageParam),
    initialPageParam: 1,
    getNextPageParam: nextPageParam,
    initialData: !q && !verifiedOnly && !lentOnly ? firstPageData(initialData) : undefined,
    placeholderData: (prev) => prev,
  });

  const items = useMemo(() => flattenRows(data), [data]);
  const total = totalOf(data);

  const patchMutation = useMutation({
    mutationFn: async ({ item, patch }: { item: Item; patch: ReturnType<typeof buildPatchForField> }) =>
      patchItemRequest(collectionId, item.id, patch, item.updatedAt),
    onMutate: async ({ item, patch }) => {
      setSaveStatus({ kind: "saving" });
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<ItemsPages>(queryKey);
      queryClient.setQueryData<ItemsPages | undefined>(queryKey, (old) =>
        mapRows(old, (row) =>
          row.id === item.id ? { ...row, ...(patch as Partial<Item>), values: { ...row.values, ...(patch.values ?? {}) } } : row,
        ),
      );
      return { previous };
    },
    onError: (err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
      if (err instanceof ConflictError) {
        queryClient.setQueryData<ItemsPages | undefined>(queryKey, (old) =>
          mapRows(old, (row) => (row.id === err.current.id ? (err.current as unknown as Item) : row)),
        );
      }
      setSaveStatus({ kind: "error" });
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<ItemsPages | undefined>(queryKey, (old) =>
        mapRows(old, (row) => (row.id === updated.id ? updated : row)),
      );
      setSaveStatus({ kind: "saved", at: new Date() });
    },
  });

  const createMutation = useMutation({
    mutationFn: (draft: ItemDraft) => createItemRequest(collectionId, draft),
    // Straight to the top of the list rather than into its sorted position:
    // the point of the dialog is that you never have to go hunting for what you
    // just added.
    onSuccess: (item) => {
      queryClient.setQueryData<ItemsPages | undefined>(queryKey, (old) => prependRow(old, item));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (item: Item) => deleteItemRequest(collectionId, item.id),
    onMutate: async (item) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<ItemsPages>(queryKey);
      queryClient.setQueryData<ItemsPages | undefined>(queryKey, (old) => removeRow(old, item.id));
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

  // Until the last page is in, say how much of the collection is on screen, so
  // a 2,000-item footer under 60 rows doesn't read as rows gone missing.
  const rowCountLabel = useMemo(() => {
    const noun = `item${total === 1 ? "" : "s"}`;
    return hasNextPage ? `${items.length} of ${total} ${noun}` : `${total} ${noun}`;
  }, [items.length, total, hasNextPage]);

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
            <button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M12 5v14"></path>
                <path d="M5 12h14"></path>
              </svg>
              Add item
            </button>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 11.5 }}>
          {view === "table" && (
            <ColumnMenu
              fields={fields}
              hiddenColumns={hiddenColumns}
              onToggle={handleToggleColumn}
              onShowAll={handleShowAllColumns}
              onResetWidths={handleResetWidths}
            />
          )}
          <SaveStatusIndicator status={saveStatus} />
        </div>
      </div>

      {view === "covers" ? (
        <CoversView items={items} fields={fields} onOpenItem={openItem} />
      ) : (
        <TableView
          items={items}
          fields={fields}
          canEdit={canEdit}
          columnWidths={columnWidths}
          hiddenColumns={hiddenColumns}
          onFieldChange={handleFieldChange}
          onDelete={(item) => deleteMutation.mutate(item)}
          onOpenItem={openItem}
          onResizeColumn={handleResizeColumn}
          onResizeColumnEnd={handleResizeColumnEnd}
          onAutoFitColumn={handleAutoFitColumn}
          rowCountLabel={rowCountLabel}
        />
      )}

      {hasNextPage && (
        <LoadMore onLoadMore={fetchNextPage} loading={isFetchingNextPage} />
      )}

      {canEdit && createOpen && (
        <CreateItemDialog
          onClose={() => setCreateOpen(false)}
          onCreate={createMutation.mutateAsync}
          collectionId={collectionId}
          fields={fields}
          lookup={lookup}
        />
      )}
    </div>
  );
}

/**
 * Fetches the next page as this scrolls into view, with a margin so the next
 * rows are usually in before the bottom is reached. The button does the same
 * for keyboard and screen-reader users, or anywhere the observer never fires.
 */
function LoadMore({ onLoadMore, loading }: { onLoadMore: () => unknown; loading: boolean }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || loading) return;
    // Re-observed after every page lands: if the sentinel is still on screen
    // (a tall viewport, a short page), the fresh observer fires again at once.
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onLoadMore();
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loading, onLoadMore]);

  return (
    <div ref={ref} style={{ display: "flex", justifyContent: "center", padding: "20px 0 8px" }}>
      <button type="button" className="btn btn-secondary" onClick={() => onLoadMore()} disabled={loading} aria-busy={loading}>
        {loading ? "Loading…" : "Load more"}
      </button>
    </div>
  );
}
