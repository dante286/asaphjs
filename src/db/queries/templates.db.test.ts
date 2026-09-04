import { describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { templates } from "@/db/schema";
import { cloneTemplateFields, listSystemTemplates } from "./templates";
import { createTestUser, systemTemplate } from "@/test/db/fixtures";

/**
 * The 15 system templates are seeded into this tier's template database by the
 * real seeder, so these read what `npm run db:seed` actually writes rather than
 * a fixture's idea of it. That matters because `createCollection` copies a
 * template's field defs onto the new collection row: a template whose fields
 * are malformed makes every collection created from it malformed too.
 */

describe("listSystemTemplates", () => {
  it("returns the seeded templates in name order", async () => {
    const rows = await listSystemTemplates();

    expect(rows).toHaveLength(15);
    expect(rows.map((r) => r.name)).toEqual([...rows.map((r) => r.name)].sort());
    expect(rows.map((r) => r.name)).toContain("Video Games");
    expect(rows.every((r) => r.ownerId === null)).toBe(true);
  });

  it("leaves out a template somebody owns", async () => {
    // `owner_id is null` is what "system" means, and the partial unique index
    // is on that too — a user's own template can reuse a system key.
    const owner = await createTestUser();
    await db.insert(templates).values({
      ownerId: owner.id,
      key: "video_games",
      name: "My Video Games",
      fields: [{ id: "title", label: "Title", type: "text", order: 0, origin: "custom" }],
    });

    expect((await listSystemTemplates()).map((t) => t.name)).not.toContain("My Video Games");
  });

  it("seeds each template with a title field first", async () => {
    // Positional: `isTitleField` is index 0, so a template whose first field
    // isn't the title would send every imported row's title into jsonb.
    for (const template of await listSystemTemplates()) {
      expect(template.fields[0]).toMatchObject({ order: 0, type: "text" });
    }
  });

  it("gives the video games template the fields a lookup fills", async () => {
    const template = await systemTemplate("video_games");

    const ids = template.fields.map((f) => f.id);
    expect(ids.slice(0, 4)).toEqual(["title", "console", "publisher", "series"]);
    // Prefill maps a provider's canonical keys onto these ids, so a rename
    // here silently stops filling that column.
    expect(ids).toContain("verified");
    expect(ids).toContain("comments");
  });
});

describe("cloneTemplateFields", () => {
  it("hands back defs a collection can own", async () => {
    // Covered as a pure function in templates.test.ts; this is the round trip
    // that matters — what comes out of the seeded row is what gets copied.
    const template = await systemTemplate("books");

    const cloned = cloneTemplateFields(template.fields);

    expect(cloned).toEqual(template.fields);
    expect(cloned[0]).not.toBe(template.fields[0]);
  });
});
