import type { FieldDef } from "./field-def";
import type { ItemPatch } from "@/db/queries/items";

// The first field (order 0) is always the item's title — promoted to the
// fixed `items.title` column rather than stored in `values`, regardless of
// what it's labeled ("Title" for most templates, "Name" for a few).
export function isTitleField(index: number): boolean {
  return index === 0;
}

// A couple of other common fields are also promoted to fixed columns (for
// the partial "lent out" index and the public-share stripping rule), rather
// than living in the generic `values` jsonb — matches ARCHITECTURE.md's
// items table design and its APEX migration mapping.
const FIXED_FIELD_TO_COLUMN: Record<string, "verified" | "borrower" | "notes"> = {
  verified: "verified",
  borrower: "borrower",
  comments: "notes",
};

export type ItemLike = {
  title: string;
  verified: boolean;
  borrower: string | null;
  notes: string | null;
  values: Record<string, unknown>;
};

export function getFieldValue(item: ItemLike, field: FieldDef, index: number): unknown {
  if (isTitleField(index)) return item.title;
  const column = FIXED_FIELD_TO_COLUMN[field.id];
  if (column) return item[column];
  return item.values[field.id];
}

export function buildPatchForField(field: FieldDef, index: number, value: unknown): ItemPatch {
  if (isTitleField(index)) return { title: String(value ?? "") };
  const column = FIXED_FIELD_TO_COLUMN[field.id];
  if (column === "verified") return { verified: Boolean(value) };
  if (column === "borrower") return { borrower: value ? String(value) : null };
  if (column === "notes") return { notes: value ? String(value) : null };
  return { values: { [field.id]: value } };
}
