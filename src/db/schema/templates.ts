import { sql } from "drizzle-orm";
import { pgTable, uuid, text, jsonb, unique, uniqueIndex } from "drizzle-orm/pg-core";
import { user } from "./auth";
import type { FieldDef } from "@/lib/fields/field-def";

export const templates = pgTable(
  "templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // null = system template (ships with the app), shared by everyone.
    ownerId: text("owner_id").references(() => user.id, { onDelete: "cascade" }),
    key: text("key").notNull(), // 'video_games', 'books', ...
    name: text("name").notNull(),
    fields: jsonb("fields").notNull().$type<FieldDef[]>(),
  },
  (table) => [
    // Per-user uniqueness (NULL owner_id rows aren't compared against each
    // other by a plain unique constraint, hence the separate partial index
    // below for system templates).
    unique("templates_owner_key_unique").on(table.ownerId, table.key),
    uniqueIndex("templates_system_key_idx")
      .on(table.key)
      .where(sql`${table.ownerId} is null`),
  ],
);
