import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  jsonb,
  boolean,
  date,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { collections } from "./collections";
import { importBatches } from "./import-batches";
import type { ExternalRef } from "@/types";

export const items = pgTable(
  "items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    collectionId: uuid("collection_id")
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    title: text("title").notNull(), // promoted: every collection has one
    coverUrl: text("cover_url"),
    sortTitle: text("sort_title").generatedAlwaysAs(sql`lower(title)`),
    verified: boolean("verified").notNull().default(false),
    borrower: text("borrower"), // null = in your possession
    lentOn: date("lent_on"),
    notes: text("notes"),
    values: jsonb("values").notNull().default({}).$type<Record<string, unknown>>(),
    externalRef: jsonb("external_ref").$type<ExternalRef | null>(),
    importBatchId: uuid("import_batch_id").references(() => importBatches.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("items_collection_idx").on(table.collectionId, table.sortTitle),
    index("items_values_idx").using("gin", table.values.op("jsonb_path_ops")),
    index("items_borrowed_idx")
      .on(table.collectionId)
      .where(sql`${table.borrower} is not null`),
    index("items_import_batch_idx").on(table.importBatchId),
  ],
);
