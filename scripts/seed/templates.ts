import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { templates } from "@/db/schema";
import { slugifyFieldLabel, TEMPLATE_TYPE_LABELS, type FieldDef } from "@/lib/fields/field-def";

// From the prototype's mock data (Archive.dc.html) — its 13 built-in collection
// templates plus "Blank", and "TV Shows" added since. Each entry is "Label:Type",
// Type being one of the human-readable labels in TEMPLATE_TYPE_LABELS.
//
// Editing a template only affects collections created after the next `db:seed`:
// createCollection() copies these field defs onto the collection row, so an
// existing shelf keeps whatever columns it was made with.
const TEMPLATES: Record<string, string[]> = {
  "Video Games": [
    "Title:Text", "Console:Select", "Publisher:Text", "Series:Text", "Region:Select",
    "Collector’s Edition:Checkbox", "Steel Book:Checkbox", "Soundtrack:Checkbox",
    "Booklet Insert:Checkbox", "Case:Checkbox", "Multiple Disks:Number",
    "Multiple Copies:Number", "Verified:Checkbox", "Borrower:Text", "Comments:Long text",
  ],
  Books: [
    "Title:Text", "Author:Text", "Publisher:Text", "Genre:Tags", "Series:Text",
    "Read:Checkbox", "Progress:Number", "Multiple Copies:Number", "Verified:Checkbox",
    "Borrower:Text", "Comments:Long text",
  ],
  Comics: [
    "Title:Text", "Author:Text", "Publisher:Text", "Genre:Tags", "Series:Text",
    "Read:Checkbox", "Progress:Number", "Verified:Checkbox", "Borrower:Text",
    "Comments:Long text",
  ],
  Manga: [
    "Title:Text", "Author:Text", "Publisher:Text", "Genre:Tags", "Series:Text",
    "Volumes:Text", "Completed:Checkbox", "Read:Checkbox", "Progress:Number",
    "Verified:Checkbox", "Borrower:Text", "Comments:Long text",
  ],
  // Release Date and Synopsis exist so a TMDB match has somewhere to put
  // `releaseDate` and `summary` — Comments is the owner's own notes (it maps to
  // items.notes) and a lookup never writes it. No Year field: the date carries
  // the year, and two columns holding the same fact both fill and then disagree
  // the moment someone edits one.
  Movies: [
    "Title:Text", "Series:Text", "Genre:Tags", "Release Date:Date", "Synopsis:Long text",
    "Verified:Checkbox", "Borrower:Text", "Comments:Long text",
  ],
  Anime: [
    "Title:Text", "Series:Text", "Genre:Tags", "Release Date:Date", "Synopsis:Long text",
    "Verified:Checkbox", "Borrower:Text", "Comments:Long text",
  ],
  // "First Aired" rather than "Release Date" because that's the fact TMDB has
  // for a series (`first_air_date`) and what a shelf label says; prefill maps
  // the id either way. Seasons/Completed/Watched mirror Manga's
  // Volumes/Completed/Read — owner facts about the boxset, never provider-filled.
  "TV Shows": [
    "Title:Text", "Series:Text", "Genre:Tags", "First Aired:Date", "Synopsis:Long text",
    "Seasons:Text", "Completed:Checkbox", "Watched:Checkbox", "Verified:Checkbox",
    "Borrower:Text", "Comments:Long text",
  ],
  Music: [
    "Album:Text", "Artist:Text", "Medium:Select", "Genre:Tags", "Soundtrack:Checkbox",
    "Borrower:Text", "Comments:Long text",
  ],
  "Board Games": ["Title:Text", "Series:Text", "Verified:Checkbox", "Borrower:Text", "Comments:Long text"],
  Legos: [
    "Title:Text", "Kit Number:Number", "Piece Count:Number", "Series:Text",
    "Verified:Checkbox", "Borrower:Text", "Comments:Long text",
  ],
  Figures: [
    "Name:Text", "Manufacturer:Text", "Game:Text", "Series:Text", "Location:Text",
    "From Collector’s Ed:Checkbox", "Verified:Checkbox", "Comments:Long text",
  ],
  Amiibos: [
    "Name:Text", "Amiibo Series:Select", "Character Number:Number", "Wave Number:Number",
    "Release Date:Date", "Verified:Checkbox", "Comments:Long text",
  ],
  "Strategy Guides": ["Title:Text", "Publisher:Text", "Series:Text", "Verified:Checkbox", "Borrower:Text", "Comments:Long text"],
  Preorders: [
    "Name:Text", "Preorder Type:Select", "Console:Select", "Order Number:Text",
    "Store:URL", "Cost:Currency", "Currency:Select", "Release Date:Date",
    "Paid:Checkbox", "Shipped:Select", "Comments:Long text",
  ],
  Blank: ["Title:Text"],
};

export function templateStringsToFieldDefs(entries: string[]): FieldDef[] {
  return entries.map((entry, index) => {
    const [label, typeLabel] = entry.split(":");
    const type = TEMPLATE_TYPE_LABELS[typeLabel.trim()];
    if (!type) throw new Error(`Unknown template field type label: ${typeLabel}`);
    return {
      id: slugifyFieldLabel(label),
      label,
      type,
      order: index,
      origin: "template",
      showInTable: type !== "longtext" && type !== "image",
      showOnCard: index === 1 && (type === "text" || type === "select"),
    } satisfies FieldDef;
  });
}

export function templateKeyFor(name: string): string {
  return slugifyFieldLabel(name);
}

export async function seedTemplates() {
  for (const [name, entries] of Object.entries(TEMPLATES)) {
    const fields = templateStringsToFieldDefs(entries);
    const key = templateKeyFor(name);
    await db
      .insert(templates)
      .values({ ownerId: null, key, name, fields })
      .onConflictDoUpdate({
        // Matches the partial unique index (templates_system_key_idx, owner_id is null).
        target: [templates.key],
        targetWhere: sql`${templates.ownerId} is null`,
        set: { name, fields },
      });
  }
  console.log(`Seeded ${Object.keys(TEMPLATES).length} system templates.`);
}
