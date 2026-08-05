import { notFound } from "next/navigation";
import { getCollectionByShareToken } from "@/db/queries/collections";
import { listItems, stripItemsForPublic } from "@/db/queries/items";
import { CoversView } from "@/components/collection/CoversView";
import { TableView } from "@/components/collection/TableView";
import { Tag } from "@/components/ui/Tag";

export const metadata = {
  robots: { index: false, follow: false },
};

export default async function PublicSharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const collection = await getCollectionByShareToken(token);
  if (!collection) notFound();

  const { rows } = await listItems({ collectionId: collection.id, pageSize: 500 });
  const publicFields = collection.fields.filter((f) => !f.private);
  const publicItems = stripItemsForPublic(rows, collection.fields).map((r) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    lentOn: r.lentOn ? String(r.lentOn) : null,
  }));

  return (
    <div style={{ minHeight: "100vh", background: "var(--color-bg)", color: "var(--color-text)" }}>
      <div className="nav" style={{ borderBottom: "1px solid var(--color-divider)", padding: "12px clamp(14px,3vw,32px)" }}>
        <span className="nav-brand">ARCHIVE</span>
        <Tag variant="outline">Public read-only view</Tag>
      </div>
      <div style={{ maxWidth: 1400, margin: "0 auto", padding: "clamp(18px,3vw,36px) clamp(14px,3vw,32px) 80px" }}>
        <h1 style={{ fontSize: "clamp(32px,4.6vw,44px)", margin: "0 0 4px" }}>{collection.name}</h1>
        <p style={{ fontSize: 13, color: "color-mix(in srgb, var(--color-text) 60%, transparent)" }}>
          Shared by the owner — {rows.length} item{rows.length === 1 ? "" : "s"}. Borrower and notes
          are hidden on public links.
        </p>

        {collection.defaultView === "table" ? (
          <TableView
            items={publicItems}
            fields={publicFields}
            canEdit={false}
            columnWidths={{}}
            hiddenColumns={[]}
            onFieldChange={() => {}}
            onDelete={() => {}}
            onOpenItem={() => {}}
            onResizeColumn={() => {}}
            onResizeColumnEnd={() => {}}
            onAutoFitColumn={() => {}}
            rowCountLabel={`${rows.length} items`}
          />
        ) : (
          <CoversView items={publicItems} fields={publicFields} onOpenItem={() => {}} />
        )}
      </div>
    </div>
  );
}
