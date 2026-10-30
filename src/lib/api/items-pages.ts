import type { InfiniteData } from "@tanstack/react-query";
import type { Item, ItemsPage } from "@/lib/api/items-client";

/**
 * The collection view's items cache is a stack of server pages rather than one
 * list, so every edit to it has to reach into whichever page holds the row.
 * These stay pure so the unit tier can cover them without a DOM.
 */
export type ItemsPages = InfiniteData<ItemsPage, number>;

export function firstPageData(page: ItemsPage): ItemsPages {
  return { pages: [page], pageParams: [page.page] };
}

/** Undefined once everything the first page counted has been asked for. */
export function nextPageParam(lastPage: ItemsPage): number | undefined {
  return lastPage.page * lastPage.pageSize < lastPage.total ? lastPage.page + 1 : undefined;
}

/**
 * Every loaded row, in page order. Offset paging can hand back a row twice when
 * the list shifts between fetches — an item added since page one was loaded
 * pushes the boundary down a slot — so the first sighting wins.
 */
export function flattenRows(data: ItemsPages | undefined): Item[] {
  if (!data) return [];
  const seen = new Set<string>();
  const rows: Item[] = [];
  for (const page of data.pages) {
    for (const row of page.rows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      rows.push(row);
    }
  }
  return rows;
}

/** The first page's count is the collection's; later pages only echo it. */
export function totalOf(data: ItemsPages | undefined): number {
  return data?.pages[0]?.total ?? 0;
}

export function mapRows(data: ItemsPages | undefined, fn: (row: Item) => Item): ItemsPages | undefined {
  if (!data) return data;
  return { ...data, pages: data.pages.map((page) => ({ ...page, rows: page.rows.map(fn) })) };
}

/** New items go to the very top, and every page's total moves with them. */
export function prependRow(data: ItemsPages | undefined, item: Item): ItemsPages | undefined {
  if (!data) return data;
  return {
    ...data,
    pages: data.pages.map((page, i) => ({
      ...page,
      rows: i === 0 ? [item, ...page.rows] : page.rows,
      total: page.total + 1,
    })),
  };
}

export function removeRow(data: ItemsPages | undefined, itemId: string): ItemsPages | undefined {
  if (!data) return data;
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      rows: page.rows.filter((row) => row.id !== itemId),
      total: page.total - 1,
    })),
  };
}
