import { and, eq, isNotNull } from "drizzle-orm";
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
        acceptedAt: null,
      },
    })
    .returning();
  return row;
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
  // 14-day expiry from invitedAt
  const invitedAt = invite.invitedAt ? new Date(invite.invitedAt).getTime() : 0;
  if (Date.now() - invitedAt > 14 * 24 * 60 * 60 * 1000) {
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
