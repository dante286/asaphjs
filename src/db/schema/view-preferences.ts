import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  primaryKey,
} from "drizzle-orm/pg-core";
import { collections } from "./collections";
import { user } from "./auth";

// Per-viewer table layout: column widths and hidden columns are a personal
// preference, not part of the collection's schema, so a shared editor's
// layout never disturbs the owner's (see ARCHITECTURE.md).
export const viewPreferences = pgTable(
  "view_preferences",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    collectionId: uuid("collection_id")
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    columnWidths: jsonb("column_widths").notNull().default({}).$type<Record<string, number>>(),
    hiddenColumns: text("hidden_columns").array().notNull().default([]),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.collectionId] })],
);
