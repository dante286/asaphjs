import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { getCollectionForUser } from "@/db/queries/collections";
import { resolveRole } from "@/db/queries/members";
import { getItem, getItemNeighbors } from "@/db/queries/items";
import { ItemDetail } from "@/components/collection/ItemDetail";

export default async function ItemDetailPage({
  params,
}: {
  params: Promise<{ slug: string; itemId: string }>;
}) {
  const { slug, itemId } = await params;
  const session = await requireSession();
  const collection = await getCollectionForUser(session.user.id, slug);
  if (!collection) notFound();

  const role = await resolveRole(collection.id, session.user.id);
  if (!role) notFound();

  const item = await getItem(itemId);
  if (!item || item.collectionId !== collection.id) notFound();

  const neighbors = await getItemNeighbors(collection.id, itemId);

  const itemSerialized = {
    ...item,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
    lentOn: item.lentOn ? String(item.lentOn) : null,
  };

  return (
    <div style={{ maxWidth: 1240, margin: "0 auto", padding: "clamp(18px,3vw,36px) clamp(14px,3vw,32px) 80px" }}>
      <ItemDetail
        collection={collection}
        item={itemSerialized}
        canEdit={role === "owner" || role === "editor"}
        neighbors={neighbors ?? { position: 1, total: 1, prevId: null, nextId: null }}
      />
    </div>
  );
}
