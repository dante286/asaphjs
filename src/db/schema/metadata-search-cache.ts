import { pgTable, uuid, text, jsonb, timestamp, unique } from "drizzle-orm/pg-core";

// Sibling to metadata_cache, keyed by normalized query text instead of a
// provider's source id — this is what search() results get cached under.
export const metadataSearchCache = pgTable(
  "metadata_search_cache",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: text("source").notNull(),
    queryNormalized: text("query_normalized").notNull(),
    payload: jsonb("payload").notNull().$type<unknown>(), // Candidate[] — cache empty results too
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("metadata_search_cache_source_query_unique").on(table.source, table.queryNormalized),
  ],
);
