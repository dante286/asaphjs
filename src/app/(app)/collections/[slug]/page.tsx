import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { getCollectionForUser } from "@/db/queries/collections";
import { resolveRole } from "@/db/queries/members";
import { getCollectionStats, getBreakdown, pickBreakdownField } from "@/db/queries/stats";
import { listItems } from "@/db/queries/items";
import { CollectionHeader } from "@/components/collection/CollectionHeader";
import { StatTiles } from "@/components/collection/StatTiles";
import { BreakdownPanel } from "@/components/collection/BreakdownPanel";
import { ItemsExplorer } from "@/components/collection/ItemsExplorer";

export default async function CollectionDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const session = await requireSession();
  const collection = await getCollectionForUser(session.user.id, slug);
  if (!collection) notFound();

  const role = await resolveRole(collection.id, session.user.id);
  if (!role) notFound();

  const [stats, initialItems] = await Promise.all([
    getCollectionStats(collection.id, collection.fields),
    listItems({ collectionId: collection.id }),
  ]);

  const breakdownField = pickBreakdownField(collection.fields);
  const breakdown = breakdownField ? await getBreakdown(collection.id, breakdownField) : [];

  const initialItemsSerialized = {
    ...initialItems,
    rows: initialItems.rows.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      lentOn: r.lentOn ? String(r.lentOn) : null,
    })),
  };

  return (
    <div style={{ maxWidth: 1400, margin: "0 auto", padding: "clamp(18px,3vw,36px) clamp(14px,3vw,32px) 80px" }}>
      <CollectionHeader collection={collection} role={role} />
      <StatTiles stats={stats} />
      {breakdownField && (
        <BreakdownPanel title={`Items per ${breakdownField.label.toLowerCase()}`} rows={breakdown} />
      )}
      <ItemsExplorer
        collectionId={collection.id}
        fields={collection.fields}
        canEdit={role === "owner" || role === "editor"}
        defaultView={(collection.defaultView as "covers" | "table") ?? "covers"}
        initialData={initialItemsSerialized}
      />
    </div>
  );
}
