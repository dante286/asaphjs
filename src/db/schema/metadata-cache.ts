import { pgTable, uuid, text, jsonb, timestamp, unique } from "drizzle-orm/pg-core";

export const metadataCache = pgTable(
  "metadata_cache",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: text("source").notNull(), // 'igdb' | 'openlibrary' | 'tmdb' | 'musicbrainz' | 'rebrickable'
    sourceId: text("source_id").notNull(),
    payload: jsonb("payload").notNull().$type<Record<string, unknown>>(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [unique("metadata_cache_source_id_unique").on(table.source, table.sourceId)],
);
