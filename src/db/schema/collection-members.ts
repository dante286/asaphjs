import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  primaryKey,
  index,
  check,
} from "drizzle-orm/pg-core";
import { collections } from "./collections";
import { user } from "./auth";

export const collectionMembers = pgTable(
  "collection_members",
  {
    collectionId: uuid("collection_id")
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    // null until the invite is accepted
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    invitedEmail: text("invited_email").notNull(),
    role: text("role").notNull().default("viewer"),
    inviteToken: text("invite_token").unique(),
    // `set null`, not the default `no action`: without an action here, an owner
    // who has ever sent an invite cannot delete their account at all. Deleting a
    // `user` row cascades to `collections` and on to these rows, but Postgres
    // fires both referential triggers as after-row triggers on the same
    // statement, in constraint-name order — `collection_members_invited_by_…`
    // sorts before `collections_owner_id_…`, so the check ran while the rows it
    // was checking were still there and raised 23503. `cascade` would also clear
    // the block, but it would be a promise this column can't keep: it would take
    // the membership with the inviter, and who invited whom is provenance while
    // the membership is the fact. Nullable already, so nothing else changes.
    invitedBy: text("invited_by").references(() => user.id, { onDelete: "set null" }),
    invitedAt: timestamp("invited_at", { withTimezone: true }).defaultNow(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.collectionId, table.invitedEmail] }),
    index("collection_members_user_idx").on(table.userId),
    check("collection_members_role_check", sql`${table.role} in ('viewer','editor')`),
  ],
);
