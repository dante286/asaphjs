import { isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { templates } from "@/db/schema";
import type { FieldDef } from "@/lib/fields/field-def";

export async function listSystemTemplates() {
  return db.query.templates.findMany({
    where: isNull(templates.ownerId),
    orderBy: (t, { asc }) => [asc(t.name)],
  });
}

export function cloneTemplateFields(fields: FieldDef[]): FieldDef[] {
  // Deep copy so later edits to a collection's own fields never mutate the
  // template row it was created from.
  return fields.map((f) => ({ ...f }));
}
