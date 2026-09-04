import { describe, expect, it } from "vitest";
import { pickBreakdownField } from "./stats";
import { field } from "@/test/factories";

describe("pickBreakdownField", () => {
  it("picks the first select field", () => {
    const picked = pickBreakdownField([
      field({ id: "title", type: "text", order: 0 }),
      field({ id: "condition", label: "Condition", type: "select", order: 1 }),
      field({ id: "region", label: "Region", type: "select", order: 2 }),
    ]);

    expect(picked?.id).toBe("condition");
  });

  it("goes by array order, not by the order property", () => {
    // The fields array is already stored in display order; reading `order`
    // instead would disagree with the panel's own heading.
    const picked = pickBreakdownField([
      field({ id: "region", label: "Region", type: "select", order: 9 }),
      field({ id: "condition", label: "Condition", type: "select", order: 1 }),
    ]);

    expect(picked?.id).toBe("region");
  });

  it("returns null when nothing is groupable", () => {
    // The panel needs a fixed set of buckets; grouping by free text would
    // produce one bucket per item.
    const picked = pickBreakdownField([
      field({ id: "title", type: "text", order: 0 }),
      field({ id: "genre", type: "tags", order: 1 }),
      field({ id: "paid", type: "currency", order: 2 }),
    ]);

    expect(picked).toBeNull();
  });

  it("returns null for a collection with no fields", () => {
    expect(pickBreakdownField([])).toBeNull();
  });
});
