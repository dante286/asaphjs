import type { FieldDef } from "@/lib/fields/field-def";
import type { ItemLike } from "@/lib/fields/item-values";

/**
 * Builders for the two shapes most of the unit tests need. They exist so a test
 * body only states the parts that matter to it — a prefill test about select
 * options shouldn't have to spell out `origin` and `order` to say so.
 *
 * Not colocated with a subject because they don't have one; they aren't tests
 * and Vitest never collects this file.
 */
export function field(over: Partial<FieldDef> & { id: string }): FieldDef {
  const { id, label, type, order, origin, ...rest } = over;
  return {
    id,
    label: label ?? id,
    type: type ?? "text",
    order: order ?? 0,
    origin: origin ?? "template",
    ...rest,
  };
}

export type TestItem = ItemLike & { coverUrl: string | null };

/** Defaults to an empty item, so a test says only which value it's testing against. */
export function item(over: Partial<TestItem> = {}): TestItem {
  return {
    title: "",
    verified: false,
    borrower: null,
    notes: null,
    values: {},
    coverUrl: null,
    ...over,
  };
}
