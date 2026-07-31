import { z } from "zod";

export const FIELD_TYPES = [
  "text",
  "longtext",
  "number",
  "checkbox",
  "date",
  "select",
  "tags",
  "currency",
  "url",
  "rating",
  "image",
] as const;

export const fieldTypeSchema = z.enum(FIELD_TYPES);
export type FieldType = z.infer<typeof fieldTypeSchema>;

// Human-readable template labels (from the prototype's mock data) mapped to
// the FieldDef type union above.
export const TEMPLATE_TYPE_LABELS: Record<string, FieldType> = {
  Text: "text",
  "Long text": "longtext",
  Number: "number",
  Checkbox: "checkbox",
  Date: "date",
  Select: "select",
  Tags: "tags",
  Currency: "currency",
  URL: "url",
  Rating: "rating",
  Image: "image",
};

export const fieldDefSchema = z.object({
  id: z.string(),
  label: z.string(),
  type: fieldTypeSchema,
  required: z.boolean().optional(),
  lookupListId: z.string().optional(),
  options: z.array(z.string()).optional(),
  currency: z.string().optional(),
  showInTable: z.boolean().optional(),
  showOnCard: z.boolean().optional(),
  order: z.number(),
  origin: z.enum(["template", "custom", "csv"]),
  // Stripped from the public share projection along with borrower/notes.
  private: z.boolean().optional(),
});

export type FieldDef = z.infer<typeof fieldDefSchema>;

export function slugifyFieldLabel(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "field";
}
