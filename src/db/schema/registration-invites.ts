import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "./auth";

/**
 * An invitation to register on an instance with signups closed — to the
 * instance, not to a collection (that's `collection_members`). Holding `token`
 * is what lets one address register once; see the gate in `src/lib/auth/auth.ts`
 * and `src/db/queries/registration-invites.ts` for what makes one pending.
 */
export const registrationInvites = pgTable("registration_invites", {
  // One invite per address, whoever sent it: re-inviting refreshes this row.
  // Lowercased and trimmed on the way in, to match `user.email`.
  email: text("email").primaryKey(),
  // `nanoid(24)`. Nullable because revoking clears it rather than deleting the
  // row, so the old link stops matching but `sent_at` stays for the cooldown.
  token: text("token").unique(),
  // `set null`, for the same reason as `collection_members.invited_by`: who sent
  // it is provenance, and must not stop the inviter deleting their account.
  invitedBy: text("invited_by").references(() => user.id, { onDelete: "set null" }),
  sentAt: timestamp("sent_at", { withTimezone: true }).defaultNow().notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  // Set when the email carrying the current token failed to send, and cleared
  // by the next invite of this address. The card shows the invite as "Not
  // sent" with Resend; there's no copy-link fallback, since a copied link proves
  // nothing about who owns the inbox.
  sendFailedAt: timestamp("send_failed_at", { withTimezone: true }),
});
