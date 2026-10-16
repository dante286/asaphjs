import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/db/client";
import { collectionMembers, collections, user } from "@/db/schema";
import type { Role } from "@/types";

/** Mirrors the role-resolution SQL from ARCHITECTURE.md. `token` is the public share token, if any was presented (e.g. from `/s/:token`). */
export async function resolveRole(
  collectionId: string,
  userId: string | null,
  token?: string | null,
): Promise<Role> {
  const collection = await db.query.collections.findFirst({
    where: eq(collections.id, collectionId),
  });
  if (!collection) return null;

  if (userId && collection.ownerId === userId) return "owner";

  if (userId) {
    const membership = await db.query.collectionMembers.findFirst({
      where: and(
        eq(collectionMembers.collectionId, collectionId),
        eq(collectionMembers.userId, userId),
        isNotNull(collectionMembers.acceptedAt),
      ),
    });
    if (membership) return membership.role as Role;
  }

  if (token && collection.shareEnabled && collection.shareToken === token) return "public";

  return null;
}

export async function listMembers(collectionId: string) {
  return db
    .select({
      collectionId: collectionMembers.collectionId,
      invitedEmail: collectionMembers.invitedEmail,
      role: collectionMembers.role,
      inviteToken: collectionMembers.inviteToken,
      invitedAt: collectionMembers.invitedAt,
      acceptedAt: collectionMembers.acceptedAt,
      userName: user.name,
    })
    .from(collectionMembers)
    .leftJoin(user, eq(user.id, collectionMembers.userId))
    .where(eq(collectionMembers.collectionId, collectionId));
}

/**
 * How long an invite link works, counted from `invitedAt`. Exported because the
 * invite email states it, and a message promising a different window from the
 * one `acceptInvite` enforces would be wrong the first time anyone relied on it.
 */
export const INVITE_TTL_DAYS = 14;

/** No timestamp counts as expired — the safe direction for something that grants access. */
export function inviteExpired(invitedAt: Date | string | null, now = Date.now()): boolean {
  const sent = invitedAt ? new Date(invitedAt).getTime() : 0;
  return now - sent > INVITE_TTL_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * Invites an address, or re-invites one with a pending invite: a fresh token, a
 * fresh `invitedAt` and the role asked for this time, so re-inviting is how an
 * owner resends — the old link dies and the 14 days start over.
 *
 * An address that has already accepted is left alone, and its row comes back
 * as it stands — `acceptedAt` set — which is how a caller tells the two apart.
 * Re-inviting used to clear `acceptedAt`, revoking the member's access until
 * they accepted again; once invites send mail that reads as "I typed their
 * address in again and they lost access and got an email". Their role has its
 * own control. The `setWhere` makes the skip part of the upsert itself, so an
 * accept landing between a read and a write can't slip past it.
 */
export async function inviteMember(params: {
  collectionId: string;
  invitedEmail: string;
  role: "viewer" | "editor";
  invitedBy: string;
}) {
  const inviteToken = nanoid(24);
  const [row] = await db
    .insert(collectionMembers)
    .values({
      collectionId: params.collectionId,
      invitedEmail: params.invitedEmail.toLowerCase(),
      role: params.role,
      inviteToken,
      invitedBy: params.invitedBy,
    })
    .onConflictDoUpdate({
      target: [collectionMembers.collectionId, collectionMembers.invitedEmail],
      set: {
        role: params.role,
        inviteToken,
        invitedBy: params.invitedBy,
        invitedAt: new Date(),
      },
      setWhere: isNull(collectionMembers.acceptedAt),
    })
    .returning();
  if (row) return row;

  // The conflict was an accepted member, so nothing was written.
  const existing = await db.query.collectionMembers.findFirst({
    where: and(
      eq(collectionMembers.collectionId, params.collectionId),
      eq(collectionMembers.invitedEmail, params.invitedEmail.toLowerCase()),
    ),
  });
  // Only if they were removed in the instant between the two statements.
  if (!existing) throw new Error("That member changed while inviting them. Try again.");
  return existing;
}

export async function updateMemberRole(
  collectionId: string,
  invitedEmail: string,
  role: "viewer" | "editor",
) {
  await db
    .update(collectionMembers)
    .set({ role })
    .where(
      and(
        eq(collectionMembers.collectionId, collectionId),
        eq(collectionMembers.invitedEmail, invitedEmail),
      ),
    );
}

export async function removeMember(collectionId: string, invitedEmail: string) {
  await db
    .delete(collectionMembers)
    .where(
      and(
        eq(collectionMembers.collectionId, collectionId),
        eq(collectionMembers.invitedEmail, invitedEmail),
      ),
    );
}

export async function acceptInvite(token: string, acceptingUserId: string, acceptingEmail: string) {
  const invite = await db.query.collectionMembers.findFirst({
    where: eq(collectionMembers.inviteToken, token),
  });
  if (!invite) return { ok: false as const, reason: "not_found" as const };
  if (invite.invitedEmail.toLowerCase() !== acceptingEmail.toLowerCase()) {
    return { ok: false as const, reason: "email_mismatch" as const };
  }
  if (inviteExpired(invite.invitedAt)) {
    return { ok: false as const, reason: "expired" as const };
  }

  await db
    .update(collectionMembers)
    .set({ userId: acceptingUserId, acceptedAt: new Date(), inviteToken: null })
    .where(
      and(
        eq(collectionMembers.collectionId, invite.collectionId),
        eq(collectionMembers.invitedEmail, invite.invitedEmail),
      ),
    );

  return { ok: true as const, collectionId: invite.collectionId };
}
