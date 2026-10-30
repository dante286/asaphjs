"use client";

import { useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Blueprint } from "@/components/ui/Blueprint";
import { CoversView } from "@/components/collection/CoversView";
import { TableView } from "@/components/collection/TableView";
import { LoadMore } from "@/components/collection/LoadMore";
import { fetchItems, type ItemsPage } from "@/lib/api/items-client";
import { firstPageData, flattenRows, nextPageParam, rowCountLabel, totalOf, type ItemsPages } from "@/lib/api/items-pages";
import type { FieldDef } from "@/lib/fields/field-def";

/**
 * The `/s/:token` page's items: the server-rendered first page, then the rest
 * through the items API with the share token, which hands back the same
 * stripped projection the server render uses. Read-only throughout — no
 * callbacks reach either view, so neither offers an edit, an open or a delete.
 */
export function PublicItemsList({
  collectionId,
  token,
  fields,
  defaultView,
  initialData,
}: {
  collectionId: string;
  token: string;
  /** Public fields only; private ones are already gone from the rows too. */
  fields: FieldDef[];
  defaultView: "covers" | "table";
  initialData: ItemsPage;
}) {
  const [q, setQ] = useState("");

  // Keyed apart from the owner's ["items", …] cache: a signed-in owner viewing
  // their own link must never get these stripped rows mixed with full ones.
  const queryKey = ["public-items", token, { q }] as const;

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery<ItemsPage, Error, ItemsPages, typeof queryKey, number>({
    queryKey,
    queryFn: ({ pageParam }) => fetchItems(collectionId, { q, token }, pageParam),
    initialPageParam: 1,
    getNextPageParam: nextPageParam,
    initialData: !q ? firstPageData(initialData) : undefined,
    placeholderData: (prev) => prev,
  });

  const items = useMemo(() => flattenRows(data), [data]);
  const total = totalOf(data);

  return (
    <div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 16 }}>
        <Blueprint style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ opacity: 0.55 }}>
            <circle cx="11" cy="11" r="7"></circle>
            <path d="m20 20-3.5-3.5"></path>
          </svg>
          <input
            type="text"
            placeholder="Filter this collection"
            aria-label="Filter this collection by title"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ border: 0, background: "transparent", font: "inherit", fontSize: 13, outline: "none", width: "min(210px,40vw)", color: "inherit" }}
          />
        </Blueprint>
        {q && (
          <span style={{ fontSize: 12, color: "color-mix(in srgb, var(--color-text) 60%, transparent)" }}>
            {total} match{total === 1 ? "" : "es"}
          </span>
        )}
      </div>

      {defaultView === "table" ? (
        <TableView
          items={items}
          fields={fields}
          canEdit={false}
          columnWidths={{}}
          hiddenColumns={[]}
          rowCountLabel={rowCountLabel(items.length, total, hasNextPage)}
        />
      ) : (
        <CoversView items={items} fields={fields} />
      )}

      {hasNextPage && <LoadMore onLoadMore={fetchNextPage} loading={isFetchingNextPage} />}
    </div>
  );
}
