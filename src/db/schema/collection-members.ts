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
    invitedBy: text("invited_by").references(() => user.id),
    invitedAt: timestamp("invited_at", { withTimezone: true }).defaultNow(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.collectionId, table.invitedEmail] }),
    index("collection_members_user_idx").on(table.userId),
    check("collection_members_role_check", sql`${table.role} in ('viewer','editor')`),
  ],
);
