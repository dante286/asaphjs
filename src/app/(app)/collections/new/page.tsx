import Link from "next/link";
import { cloneTemplateFields, listSystemTemplates } from "@/db/queries/templates";
import { CreateCollectionWizard } from "@/components/create-collection/CreateCollectionWizard";

export default async function NewCollectionPage() {
  const templates = await listSystemTemplates();

  return (
    <div style={{ maxWidth: 1400, margin: "0 auto", padding: "clamp(18px,3vw,36px) clamp(14px,3vw,32px) 80px" }}>
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
        / New
      </div>
      <h1 style={{ fontSize: "clamp(32px,4.6vw,44px)", margin: "0 0 4px" }}>New collection</h1>
      <p style={{ fontSize: 14, color: "color-mix(in srgb, var(--color-text) 65%, transparent)", maxWidth: "62ch" }}>
        Pick a template for the shape of the data. Every field below can be renamed, removed, or
        joined by your own — templates are a starting point, not a schema lock.
      </p>

      <CreateCollectionWizard
        // Cloned rather than handed over as-is: these are the shared system
        // template rows, and the wizard's copy of them becomes the new
        // collection's own fields. The RSC boundary happens to serialize them
        // on the way to the client, but that is a property of the boundary
        // rather than a guarantee this path is entitled to rely on.
        templates={templates.map((t) => ({
          key: t.key,
          name: t.name,
          fields: cloneTemplateFields(t.fields),
        }))}
      />
    </div>
  );
}
