import { relations } from "drizzle-orm";
import { user } from "./auth";
import { templates } from "./templates";
import { collections } from "./collections";
import { items } from "./items";
import { collectionMembers } from "./collection-members";
import { lookupLists, lookupValues } from "./lookup-lists";
import { importBatches } from "./import-batches";
import { viewPreferences } from "./view-preferences";

export * from "./auth";
export * from "./templates";
export * from "./collections";
export * from "./items";
export * from "./collection-members";
export * from "./lookup-lists";
export * from "./metadata-cache";
export * from "./metadata-search-cache";
export * from "./import-batches";
export * from "./view-preferences";

export const templatesRelations = relations(templates, ({ one }) => ({
  owner: one(user, { fields: [templates.ownerId], references: [user.id] }),
}));

export const collectionsRelations = relations(collections, ({ one, many }) => ({
  owner: one(user, { fields: [collections.ownerId], references: [user.id] }),
  items: many(items),
  members: many(collectionMembers),
  importBatches: many(importBatches),
}));

export const itemsRelations = relations(items, ({ one }) => ({
  collection: one(collections, { fields: [items.collectionId], references: [collections.id] }),
  importBatch: one(importBatches, {
    fields: [items.importBatchId],
    references: [importBatches.id],
  }),
}));

export const collectionMembersRelations = relations(collectionMembers, ({ one }) => ({
  collection: one(collections, {
    fields: [collectionMembers.collectionId],
    references: [collections.id],
  }),
  user: one(user, { fields: [collectionMembers.userId], references: [user.id] }),
  invitedByUser: one(user, {
    fields: [collectionMembers.invitedBy],
    references: [user.id],
  }),
}));

export const lookupListsRelations = relations(lookupLists, ({ one, many }) => ({
  owner: one(user, { fields: [lookupLists.ownerId], references: [user.id] }),
  values: many(lookupValues),
}));

export const lookupValuesRelations = relations(lookupValues, ({ one }) => ({
  list: one(lookupLists, { fields: [lookupValues.listId], references: [lookupLists.id] }),
}));

export const importBatchesRelations = relations(importBatches, ({ one, many }) => ({
  collection: one(collections, {
    fields: [importBatches.collectionId],
    references: [collections.id],
  }),
  items: many(items),
}));

export const viewPreferencesRelations = relations(viewPreferences, ({ one }) => ({
  collection: one(collections, {
    fields: [viewPreferences.collectionId],
    references: [collections.id],
  }),
  user: one(user, { fields: [viewPreferences.userId], references: [user.id] }),
}));
