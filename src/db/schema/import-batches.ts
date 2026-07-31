import { pgTable, uuid, text, jsonb, timestamp, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { collections } from "./collections";
import type { ImportMappings } from "@/types";

export type ImportRowError = { row: number; message: string };

export const importBatches = pgTable(
  "import_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    collectionId: uuid("collection_id")
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("staged"), // staged | committed | rolled_back
    mapping: jsonb("mapping").notNull().default({}).$type<ImportMappings>(),
    errorReport: jsonb("error_report").notNull().default([]).$type<ImportRowError[]>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      "import_batches_status_check",
      sql`${table.status} in ('staged','committed','rolled_back')`,
    ),
  ],
);
