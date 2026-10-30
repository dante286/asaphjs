import { requireSession, getSession } from "@/lib/auth/session";
import { requestOrigin } from "@/lib/request-origin";
import { listCollectionsForUser } from "@/db/queries/collections";
import { INVITE_TTL_DAYS, inviteExpired, listMembers } from "@/db/queries/members";
import {
  INVITE_RESEND_COOLDOWN_SECONDS,
  MAX_PENDING_INVITES,
  listPendingInvites,
} from "@/db/queries/registration-invites";
import { registrationInvitesAvailable } from "@/lib/auth/registration-invites";
import { ProfileForm } from "@/components/account/ProfileForm";
import { SecurityPanel } from "@/components/account/SecurityPanel";
import { CollectionSettingsCard } from "@/components/account/CollectionSettingsCard";
import { SharingCard } from "@/components/account/SharingCard";
import { InviteSomeoneCard } from "@/components/account/InviteSomeoneCard";
import { DataExportButtons } from "@/components/account/DataExportButtons";
import { SignOutButton } from "@/components/account/SignOutButton";

export default async function AccountPage() {
  const session = await requireSession();
  // additionalFields (timeZone/currency) aren't in the base Session type — re-read via getSession's raw shape.
  const full = (await getSession())?.user as typeof session.user & {
    timeZone?: string;
    currency?: string;
  };

  const origin = await requestOrigin();
  const collectionRows = await listCollectionsForUser(session.user.id);
  const owned = collectionRows.filter((r) => r.isOwner);

  // Read per request, like ALLOW_SIGNUPS on /auth: getSession() reads headers(),
  // so this page is dynamic and none of it is frozen into the build.
  const pendingInvites = registrationInvitesAvailable() ? await listPendingInvites(session.user.id) : null;

  const sharingCards = await Promise.all(
    owned.map(async (row) => ({
      row,
      members: await listMembers(row.collection.id),
    })),
  );

  return (
    <div style={{ maxWidth: 920, margin: "0 auto", padding: "clamp(18px,3vw,36px) clamp(14px,3vw,32px) 80px" }}>
      <h1 style={{ fontSize: "clamp(32px,4.6vw,44px)", margin: "0 0 22px" }}>Account</h1>

      <h6 style={{ marginBottom: 10 }}>Profile</h6>
      <ProfileForm
        displayName={session.user.name}
        email={session.user.email}
        timeZone={full?.timeZone ?? "UTC"}
        currency={full?.currency ?? "USD"}
      />

      <h6 style={{ marginBottom: 10 }}>Security</h6>
      {/* Counts are the owned ones only: collections shared *with* you survive
          your account, so naming them in a delete confirmation would overstate it. */}
      <SecurityPanel
        collectionCount={owned.length}
        itemCount={owned.reduce((sum, row) => sum + row.itemCount, 0)}
      />

      <h6 style={{ marginBottom: 10 }}>Collections</h6>
      {owned.map((row) => (
        <CollectionSettingsCard
          key={row.collection.id}
          collectionId={row.collection.id}
          collectionName={row.collection.name}
          collectionSlug={row.collection.slug}
          itemCount={row.itemCount}
          templateKey={row.collection.templateKey}
        />
      ))}
      {owned.length === 0 && (
        <p style={{ fontSize: 13, color: "color-mix(in srgb, var(--color-text) 60%, transparent)", marginBottom: 26 }}>
          Nothing to manage yet — collections you own show up here to rename or delete.
        </p>
      )}

      <h6 style={{ marginBottom: 10 }}>Sharing</h6>
      {sharingCards.map(({ row, members }) => (
        <SharingCard
          key={row.collection.id}
          collectionId={row.collection.id}
          collectionName={row.collection.name}
          itemCount={row.itemCount}
          shareEnabled={row.collection.shareEnabled}
          shareUrl={row.collection.shareToken ? `${origin}/s/${row.collection.shareToken}` : null}
          members={members.map((m) => {
            // A pending invite's link, built here for the same reason as
            // shareUrl. None once accepted (the token is burned) or expired
            // (copying a dead link helps nobody; inviting again mints a new one).
            const pending = !m.acceptedAt && m.inviteToken !== null;
            const expired = pending && inviteExpired(m.invitedAt);
            return {
              invitedEmail: m.invitedEmail,
              role: m.role,
              userName: m.userName,
              acceptedAt: m.acceptedAt,
              inviteUrl: pending && !expired ? `${origin}/invite/${m.inviteToken}` : null,
              expired,
            };
          })}
        />
      ))}
      {sharingCards.length === 0 && (
        <p style={{ fontSize: 13, color: "color-mix(in srgb, var(--color-text) 60%, transparent)" }}>
          Create a collection to start sharing it.
        </p>
      )}
      <p style={{ fontSize: 11.5, color: "color-mix(in srgb, var(--color-text) 55%, transparent)", marginTop: -16, marginBottom: 26 }}>
        People you invite open their link — emailed, or copied from here — signed in to their own
        account, and see this collection alongside their own. Inviting a pending address again
        sends a fresh link and retires the old one. The collection stays private, and borrower
        notes stay hidden on public links only.
      </p>

      {pendingInvites && (
        <>
          <h6 style={{ marginBottom: 10 }}>Invite someone</h6>
          <InviteSomeoneCard
            invites={pendingInvites.map((invite) => ({
              email: invite.email,
              sentAt: invite.sentAt.toISOString(),
              notSent: invite.sendFailedAt !== null,
            }))}
            cooldownSeconds={INVITE_RESEND_COOLDOWN_SECONDS}
            maxPending={MAX_PENDING_INVITES}
            expiresInDays={INVITE_TTL_DAYS}
          />
        </>
      )}

      <h6 style={{ marginBottom: 10 }}>Data</h6>
      <DataExportButtons />

      <div
        style={{
          marginTop: 26,
          display: "flex",
          justifyContent: "flex-end",
          alignItems: "center",
          gap: 14,
          paddingTop: 16,
          borderTop: "1px solid var(--color-divider)",
        }}
      >
        <SignOutButton />
      </div>
    </div>
  );
}
