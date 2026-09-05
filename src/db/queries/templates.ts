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
  // template row it was created from. System template rows are shared by every
  // collection created from them, so a shallow copy would leave a select's
  // `options` array pointing at the template's own — pushing an option onto the
  // new collection's field would be visible to anything else reading that row
  // in the same request.
  //
  // structuredClone rather than a hand-written `{ ...f, options: [...] }` so it
  // keeps holding for whatever array- or object-shaped key FieldDef gains next.
  return structuredClone(fields);
}
