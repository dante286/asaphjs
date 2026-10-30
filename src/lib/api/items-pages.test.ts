import { describe, expect, it } from "vitest";
import type { Item, ItemsPage } from "./items-client";
import { firstPageData, flattenRows, mapRows, nextPageParam, prependRow, removeRow, rowCountLabel, totalOf, type ItemsPages } from "./items-pages";

function item(id: string, over: Partial<Item> = {}): Item {
  return { id, title: id, values: {}, ...over } as Item;
}

function page(n: number, ids: string[], total: number, pageSize = 2): ItemsPage {
  return { rows: ids.map((id) => item(id)), total, page: n, pageSize };
}

function pages(...ps: ItemsPage[]): ItemsPages {
  return { pages: ps, pageParams: ps.map((p) => p.page) };
}

describe("nextPageParam", () => {
  it("asks for the next page while the total isn't covered", () => {
    expect(nextPageParam(page(1, ["a", "b"], 5))).toBe(2);
    expect(nextPageParam(page(2, ["c", "d"], 5))).toBe(3);
  });

  it("stops once the last page has been asked for", () => {
    expect(nextPageParam(page(3, ["e"], 5))).toBeUndefined();
    expect(nextPageParam(page(2, ["c", "d"], 4))).toBeUndefined();
  });

  it("stops at once for an empty collection", () => {
    expect(nextPageParam(page(1, [], 0))).toBeUndefined();
  });
});

describe("firstPageData", () => {
  it("seeds the cache with the server-rendered page under its own page number", () => {
    const first = page(1, ["a", "b"], 5);
    expect(firstPageData(first)).toEqual({ pages: [first], pageParams: [1] });
  });
});

describe("flattenRows", () => {
  it("joins pages in order", () => {
    const data = pages(page(1, ["a", "b"], 4), page(2, ["c", "d"], 4));
    expect(flattenRows(data).map((r) => r.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("keeps the first sighting when a shifted boundary repeats a row", () => {
    // An item added after page one loaded pushes "b" onto page two as well.
    const data = pages(page(1, ["new", "a", "b"], 5), page(2, ["b", "c"], 5));
    expect(flattenRows(data).map((r) => r.id)).toEqual(["new", "a", "b", "c"]);
  });

  it("is empty before anything has loaded", () => {
    expect(flattenRows(undefined)).toEqual([]);
  });
});

describe("totalOf", () => {
  it("reads the first page's count", () => {
    expect(totalOf(pages(page(1, ["a", "b"], 2000), page(2, ["c", "d"], 1999)))).toBe(2000);
    expect(totalOf(undefined)).toBe(0);
  });
});

describe("mapRows", () => {
  it("reaches a row on any page", () => {
    const data = pages(page(1, ["a", "b"], 4), page(2, ["c", "d"], 4));
    const next = mapRows(data, (r) => (r.id === "c" ? { ...r, title: "Changed" } : r));
    expect(next?.pages[1].rows[0].title).toBe("Changed");
    expect(next?.pages[0].rows).toEqual(data.pages[0].rows);
  });

  it("leaves an empty cache alone", () => {
    expect(mapRows(undefined, (r) => r)).toBeUndefined();
  });
});

describe("prependRow", () => {
  it("puts the new item at the very top and counts it on every page", () => {
    const data = pages(page(1, ["a", "b"], 4), page(2, ["c", "d"], 4));
    const next = prependRow(data, item("new"))!;
    expect(flattenRows(next).map((r) => r.id)).toEqual(["new", "a", "b", "c", "d"]);
    expect(next.pages.map((p) => p.total)).toEqual([5, 5]);
  });
});

describe("removeRow", () => {
  it("drops the row from whichever page has it and counts it out everywhere", () => {
    const data = pages(page(1, ["a", "b"], 4), page(2, ["c", "d"], 4));
    const next = removeRow(data, "d")!;
    expect(flattenRows(next).map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(next.pages.map((p) => p.total)).toEqual([3, 3]);
  });
});

describe("rowCountLabel", () => {
  it("says how much is loaded until the last page is in", () => {
    expect(rowCountLabel(60, 2000, true)).toBe("60 of 2000 items");
    expect(rowCountLabel(2000, 2000, false)).toBe("2000 items");
    expect(rowCountLabel(1, 1, false)).toBe("1 item");
  });
});
