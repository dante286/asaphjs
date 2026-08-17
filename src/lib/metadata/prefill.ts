import type { FieldDef } from "@/lib/fields/field-def";
import { getFieldValue, isFixedColumnField, isTitleField, type ItemLike } from "@/lib/fields/item-values";
import type { ItemPatch } from "@/db/queries/items";
import type { HydratedFields } from "./types";

/**
 * Field id -> the canonical hydrate key that feeds it. Field ids are
 * slugifyFieldLabel output, so this covers what the built-in templates produce
 * plus the labels someone renaming a column would plausibly land on. A field id
 * that isn't listed is never touched by a lookup — including every checkbox on
 * the Video Games template, since whether *your* copy has the booklet insert is
 * not something IGDB could know.
 */
const CANONICAL_BY_FIELD_ID: Record<string, keyof HydratedFields> = {
  publisher: "publisher",
  developer: "developer",
  manufacturer: "developer",
  author: "author",
  artist: "author",
  console: "platforms",
  platform: "platforms",
  system: "platforms",
  genre: "genre",
  genres: "genre",
  series: "series",
  franchise: "series",
  release_date: "releaseDate",
  released: "releaseDate",
  year: "year",
  description: "summary",
  synopsis: "summary",
  summary: "summary",
};

// Provider data can't decide these: currency/rating are the owner's own
// valuation, image is the cover (handled separately), and a checkbox is a fact
// about the physical copy on the shelf.
const UNFILLABLE_TYPES = new Set<FieldDef["type"]>(["checkbox", "currency", "rating", "image"]);

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function asStrings(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((v): v is string => typeof v === "string" && v.trim() !== "");
  if (typeof raw === "string" && raw.trim() !== "") return [raw];
  if (typeof raw === "number" && Number.isFinite(raw)) return [String(raw)];
  return [];
}

/**
 * A value the FieldCell for this field can actually render and round-trip, or
 * undefined to leave the field alone. Notably: a select only accepts one of its
 * own options (FieldCell renders `<select>` and would silently show blank for
 * anything else), and a multi-platform release only fills a free-text console
 * field when there's exactly one platform to name — "Satellaview · SNES · Wii"
 * is not an answer to "which console is your copy for".
 */
function coerceForField(field: FieldDef, canonical: keyof HydratedFields, raw: unknown): unknown {
  const values = asStrings(raw);
  if (values.length === 0) return undefined;

  if (field.type === "select") {
    if (!field.options?.length) return values.length === 1 ? values[0] : undefined;
    const byLower = new Map(field.options.map((o) => [o.trim().toLowerCase(), o]));
    for (const value of values) {
      const match = byLower.get(value.trim().toLowerCase());
      if (match) return match;
    }
    return undefined;
  }

  if (field.type === "tags") return values;

  if (field.type === "number") {
    const n = Number(values[0]);
    return Number.isFinite(n) ? n : undefined;
  }

  if (field.type === "date") {
    return /^\d{4}-\d{2}-\d{2}$/.test(values[0]) ? values[0] : undefined;
  }

  // text / longtext / url — a genre list reads fine joined; an ambiguous
  // platform list does not.
  if (values.length === 1) return values[0];
  return canonical === "genre" ? values.join(", ") : undefined;
}

export type PrefillPlan = {
  patch: ItemPatch;
  /** Field labels the lookup filled in — what the UI reports back. */
  applied: string[];
  /** Field labels the provider had data for but that already had a value. */
  keptExisting: string[];
};

/**
 * Turns a provider's hydrate payload into a patch for this collection's fields.
 * Without `overwrite` it only fills blanks, so an owner's own corrections always
 * survive a match; the item detail page's re-run passes `overwrite: true`.
 */
export function buildPrefillPlan(
  fields: FieldDef[],
  item: ItemLike & { coverUrl: string | null },
  hydrated: HydratedFields,
  { overwrite = false }: { overwrite?: boolean } = {},
): PrefillPlan {
  const patch: ItemPatch = {};
  const values: Record<string, unknown> = {};
  const applied: string[] = [];
  const keptExisting: string[] = [];

  fields.forEach((field, index) => {
    if (isTitleField(index)) {
      const title = typeof hydrated.title === "string" ? hydrated.title.trim() : "";
      if (!title || title === item.title) return;
      if (!overwrite && !isEmpty(item.title)) {
        keptExisting.push(field.label);
        return;
      }
      patch.title = title;
      applied.push(field.label);
      return;
    }

    // verified/borrower/notes: owner-only facts, never provider-fillable.
    if (isFixedColumnField(field.id) || UNFILLABLE_TYPES.has(field.type)) return;

    const canonical = CANONICAL_BY_FIELD_ID[field.id];
    if (!canonical) return;

    const value = coerceForField(field, canonical, hydrated[canonical]);
    if (value === undefined) return;

    const current = getFieldValue(item, field, index);
    if (!overwrite && !isEmpty(current)) {
      keptExisting.push(field.label);
      return;
    }
    if (JSON.stringify(current ?? null) === JSON.stringify(value)) return;

    values[field.id] = value;
    applied.push(field.label);
  });

  if (Object.keys(values).length > 0) patch.values = values;

  if (typeof hydrated.coverUrl === "string" && hydrated.coverUrl !== item.coverUrl) {
    if (overwrite || isEmpty(item.coverUrl)) {
      patch.coverUrl = hydrated.coverUrl;
      applied.push("Cover");
    } else {
      keptExisting.push("Cover");
    }
  }

  return { patch, applied, keptExisting };
}
