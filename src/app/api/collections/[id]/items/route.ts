import { NextResponse } from "next/server";
import { z } from "zod";
import { isGuardResponse, requireRole } from "@/lib/auth/api-guard";
import { createItem, listItems, stripItemsForPublic } from "@/db/queries/items";
import { getCollectionById } from "@/db/queries/collections";
import { getProvider } from "@/lib/metadata/providers";
import { resolveLookupConfig } from "@/lib/metadata/lookup-config";
import { mirrorCover } from "@/lib/metadata/cover-mirror";
import type { ExternalRef } from "@/types";

/**
 * The create dialog sends a whole item, not just a title. `match` is the
 * provider candidate it previewed against: only the source id is taken from the
 * client — the cover and the provenance stamp are re-read server-side, so a
 * forged body can't point an item's cover at an arbitrary URL.
 */
const newItemSchema = z.object({
  title: z.string().trim().min(1),
  values: z.record(z.string(), z.unknown()).optional(),
  verified: z.boolean().optional(),
  borrower: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  match: z.object({ sourceId: z.string().min(1) }).optional(),
});

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await requireRole(request, id, ["owner", "editor", "viewer", "public"]);
  if (isGuardResponse(guard)) return guard;

  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? undefined;
  const verifiedOnly = url.searchParams.get("verifiedOnly") === "1";
  const lentOnly = url.searchParams.get("lentOnly") === "1";
  const page = Number(url.searchParams.get("page") ?? "1");

  const result = await listItems({ collectionId: id, q, verifiedOnly, lentOnly, page });

  if (guard.role === "public") {
    const collection = await getCollectionById(id);
    return NextResponse.json({
      ...result,
      rows: stripItemsForPublic(result.rows, collection?.fields ?? []),
    });
  }

  return NextResponse.json(result);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await requireRole(request, id, ["owner", "editor"]);
  if (isGuardResponse(guard)) return guard;

  const parsed = newItemSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const onTitle = parsed.error.issues.some((issue) => issue.path[0] === "title");
    return NextResponse.json(
      { error: onTitle ? "Title is required." : "That item couldn't be saved as sent." },
      { status: 400 },
    );
  }

  const { match, ...draft } = parsed.data;
  let coverUrl: string | null = null;
  let externalRef: ExternalRef | null = null;

  if (match) {
    const collection = await getCollectionById(id);
    const lookup = collection ? resolveLookupConfig(collection) : null;
    if (!lookup) {
      return NextResponse.json({ error: "This collection has no metadata provider configured." }, { status: 400 });
    }

    try {
      // Cached by the dialog's own preview of this candidate, so in the normal
      // flow this is a DB read rather than another call against the free tier.
      const hydrated = await getProvider(lookup.key).hydrate(match.sourceId);
      if (typeof hydrated.coverUrl === "string") {
        // Serve the art ourselves when we can; fall back to the provider's URL.
        coverUrl = (await mirrorCover(hydrated.coverUrl)) ?? hydrated.coverUrl;
      }
      externalRef = { source: lookup.key, id: match.sourceId, fetchedAt: new Date().toISOString() };
    } catch (err) {
      // The values this match filled in are in the body already — the owner
      // reviewed them in the dialog — so a provider that has gone away costs the
      // cover art and the provenance link, not the whole draft. The item lands
      // unmatched and the detail page's lookup panel can link it later.
      console.error("Metadata lookup failed while creating an item", err);
    }
  }

  const item = await createItem({ collectionId: id, ...draft, coverUrl, externalRef });
  return NextResponse.json(item, { status: 201 });
}
