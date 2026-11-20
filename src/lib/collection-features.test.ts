import { describe, expect, it } from "vitest";
import { trackedFeatures } from "./collection-features";

describe("trackedFeatures", () => {
  it("tracks both when the collection says nothing, so older collections are unchanged", () => {
    expect(trackedFeatures({})).toEqual({ verified: true, lending: true });
    expect(trackedFeatures(null)).toEqual({ verified: true, lending: true });
    expect(trackedFeatures({ lookup: "igdb" })).toEqual({ verified: true, lending: true });
  });

  it("turns off only what is explicitly false", () => {
    expect(trackedFeatures({ verified: false })).toEqual({ verified: false, lending: true });
    expect(trackedFeatures({ lending: false, verified: true })).toEqual({ verified: true, lending: false });
  });
});
