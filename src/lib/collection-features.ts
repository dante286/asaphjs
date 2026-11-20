import type { CollectionFeatures } from "@/types";

export type TrackedFeatures = { verified: boolean; lending: boolean };

/**
 * Whether a collection tracks verified copies and lending: the two options the
 * create-collection wizard offers. When one is off, its checkbox or borrower
 * field, filter, badge and stat are hidden everywhere the collection is shown.
 *
 * Absent means on. Every collection made before the options were read (or
 * made by a path that doesn't send them, like a template with no features)
 * keeps showing what it always showed. Only an explicit `false` hides anything.
 */
export function trackedFeatures(features: CollectionFeatures | null | undefined): TrackedFeatures {
  return {
    verified: features?.verified !== false,
    lending: features?.lending !== false,
  };
}
