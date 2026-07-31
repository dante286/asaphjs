import { pgTable, uuid, text, integer } from "drizzle-orm/pg-core";
import { user } from "./auth";

export const lookupLists = pgTable("lookup_lists", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: text("owner_id").references(() => user.id, { onDelete: "cascade" }), // null = system list
  key: text("key").notNull(), // 'consoles', 'regions', 'mediums'
  name: text("name").notNull(),
});

export const lookupValues = pgTable("lookup_values", {
  id: uuid("id").primaryKey().defaultRandom(),
  listId: uuid("list_id")
    .notNull()
    .references(() => lookupLists.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  sort: integer("sort").default(0),
});
