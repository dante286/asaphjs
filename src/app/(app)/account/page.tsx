import { requireSession, getSession } from "@/lib/auth/session";
import { listCollectionsForUser } from "@/db/queries/collections";
import { listMembers } from "@/db/queries/members";
import { ProfileForm } from "@/components/account/ProfileForm";
import { SecurityPanel } from "@/components/account/SecurityPanel";
import { CollectionSettingsCard } from "@/components/account/CollectionSettingsCard";
import { SharingCard } from "@/components/account/SharingCard";
import { DataExportButtons } from "@/components/account/DataExportButtons";
import { SignOutButton } from "@/components/account/SignOutButton";

export default async function AccountPage() {
  const session = await requireSession();
  // additionalFields (timeZone/currency) aren't in the base Session type — re-read via getSession's raw shape.
  const full = (await getSession())?.user as typeof session.user & {
    timeZone?: string;
    currency?: string;
  };

  const collectionRows = await listCollectionsForUser(session.user.id);
  const owned = collectionRows.filter((r) => r.isOwner);

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
      <SecurityPanel />

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
          shareToken={row.collection.shareToken}
          members={members.map((m) => ({
            invitedEmail: m.invitedEmail,
            role: m.role,
            userName: m.userName,
            acceptedAt: m.acceptedAt,
          }))}
        />
      ))}
      {sharingCards.length === 0 && (
        <p style={{ fontSize: 13, color: "color-mix(in srgb, var(--color-text) 60%, transparent)" }}>
          Create a collection to start sharing it.
        </p>
      )}
      <p style={{ fontSize: 11.5, color: "color-mix(in srgb, var(--color-text) 55%, transparent)", marginTop: -16, marginBottom: 26 }}>
        People you invite sign in to their own account and see this collection alongside their
        own — the collection stays private, and borrower notes stay hidden on public links only.
      </p>

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
