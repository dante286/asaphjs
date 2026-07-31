import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { getCollectionForUser } from "@/db/queries/collections";
import { resolveRole } from "@/db/queries/members";
import { ImportWizard } from "@/components/create-collection/ImportWizard";

export default async function ImportPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await requireSession();
  const collection = await getCollectionForUser(session.user.id, slug);
  if (!collection) notFound();

  const role = await resolveRole(collection.id, session.user.id);
  if (role !== "owner" && role !== "editor") notFound();

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "clamp(18px,3vw,36px) clamp(14px,3vw,32px) 80px" }}>
      <div
        style={{
          fontSize: 11,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "color-mix(in srgb, var(--color-text) 55%, transparent)",
          marginBottom: 10,
        }}
      >
        <Link href="/" style={{ textDecoration: "none" }}>
          Collections
        </Link>{" "}
        /{" "}
        <Link href={`/collections/${collection.slug}`} style={{ textDecoration: "none" }}>
          {collection.name}
        </Link>{" "}
        / Import CSV
      </div>
      <h1 style={{ fontSize: "clamp(32px,4.6vw,44px)", margin: "0 0 4px" }}>Import CSV</h1>
      <p style={{ fontSize: 14, color: "color-mix(in srgb, var(--color-text) 65%, transparent)", maxWidth: "62ch" }}>
        Map each column to an existing field, a new one, or skip it. The mapping is remembered for
        next time.
      </p>

      <ImportWizard
        collectionSlug={collection.slug}
        collectionId={collection.id}
        existingFields={collection.fields}
        savedMapping={collection.importMappings}
      />
    </div>
  );
}
