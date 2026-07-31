import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  jsonb,
  boolean,
  timestamp,
  unique,
  check,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import type { FieldDef } from "@/lib/fields/field-def";
import type { CollectionFeatures, ImportMappings } from "@/types";

export const collections = pgTable(
  "collections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    templateKey: text("template_key"), // provenance only
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    fields: jsonb("fields").notNull().$type<FieldDef[]>(),
    defaultView: text("default_view").notNull().default("covers"),
    features: jsonb("features").notNull().default({}).$type<CollectionFeatures>(),
    // CSV header -> field id mapping, persisted so repeat imports need no remapping.
    importMappings: jsonb("import_mappings").notNull().default({}).$type<ImportMappings>(),
    shareToken: text("share_token").unique(),
    shareEnabled: boolean("share_enabled").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("collections_owner_slug_unique").on(table.ownerId, table.slug),
    check("collections_default_view_check", sql`${table.defaultView} in ('covers','table')`),
  ],
);
