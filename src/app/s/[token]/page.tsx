import { notFound } from "next/navigation";
import { getCollectionByShareToken } from "@/db/queries/collections";
import { listItems, stripItemsForPublic } from "@/db/queries/items";
import { PublicItemsList } from "@/components/collection/PublicItemsList";
import { toClientItem } from "@/lib/api/items-client";
import { Tag } from "@/components/ui/Tag";

export const metadata = {
  robots: { index: false, follow: false },
};

export default async function PublicSharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const collection = await getCollectionByShareToken(token);
  if (!collection) notFound();

  // One page server-rendered for the first paint; PublicItemsList pages in the
  // rest through the items API with this token.
  const firstPage = await listItems({ collectionId: collection.id });
  const { total } = firstPage;
  const publicFields = collection.fields.filter((f) => !f.private);
  const initialData = {
    ...firstPage,
    rows: stripItemsForPublic(firstPage.rows, collection.fields).map(toClientItem),
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--color-bg)", color: "var(--color-text)" }}>
      <div className="nav" style={{ borderBottom: "1px solid var(--color-divider)", padding: "12px clamp(14px,3vw,32px)" }}>
        <span className="nav-brand">ASAPH</span>
        <Tag variant="outline">Public read-only view</Tag>
      </div>
      <div style={{ maxWidth: 1400, margin: "0 auto", padding: "clamp(18px,3vw,36px) clamp(14px,3vw,32px) 80px" }}>
        <h1 style={{ fontSize: "clamp(32px,4.6vw,44px)", margin: "0 0 4px" }}>{collection.name}</h1>
        <p style={{ fontSize: 13, color: "color-mix(in srgb, var(--color-text) 60%, transparent)" }}>
          Shared by the owner — {total} item{total === 1 ? "" : "s"}. Borrower and notes
          are hidden on public links.
        </p>

        {/*
          No callback props cross from here: a function passed into a Client
          Component from this Server Component is what used to make this page
          500. PublicItemsList keeps its views read-only on its own side.
        */}
        <PublicItemsList
          collectionId={collection.id}
          token={token}
          fields={publicFields}
          defaultView={collection.defaultView === "table" ? "table" : "covers"}
          initialData={initialData}
        />
      </div>
    </div>
  );
}
