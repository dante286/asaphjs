import { NextResponse } from "next/server";
import { z } from "zod";
import { isGuardResponse, requireRole } from "@/lib/auth/api-guard";
import { deleteItem, patchItem } from "@/db/queries/items";

/**
 * Bigger than any per-field autosave or a long notes field, small enough that
 * nobody can make the server buffer and parse an arbitrarily large body.
 */
const MAX_PATCH_BYTES = 256 * 1024;

/**
 * What a client may change on an item. Parsed, not just typed: this is a public
 * endpoint, and the body used to reach `patchItem` as sent.
 *
 * Deliberately absent:
 * - `coverUrl` — covers are minted server-side only (the photo route, a lookup
 *   apply, create-with-match). A client-chosen URL could name another item's
 *   upload, which the next photo change or delete would then unlink.
 * - `externalRef` — lookup provenance the metadata actions own, so a client
 *   can't claim an item was matched from a provider it never was.
 *
 * `.strip()` (zod's default) drops both silently, so an older client that still
 * sends them gets the rest of its patch applied rather than a 400.
 */
const itemPatchSchema = z.object({
  title: z.string().max(1000).optional(),
  verified: z.boolean().optional(),
  borrower: z.string().max(1000).nullable().optional(),
  lentOn: z.iso.date().nullable().optional(),
  notes: z.string().max(50_000).nullable().optional(),
  values: z.record(z.string().min(1).max(200), z.unknown()).optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  const { id, itemId } = await params;
  const guard = await requireRole(request, id, ["owner", "editor"]);
  if (isGuardResponse(guard)) return guard;

  if (Number(request.headers.get("content-length") ?? 0) > MAX_PATCH_BYTES) {
    return NextResponse.json({ error: "That change is too large to save." }, { status: 413 });
  }
  const raw = await request.text();
  if (raw.length > MAX_PATCH_BYTES) {
    return NextResponse.json({ error: "That change is too large to save." }, { status: 413 });
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    json = null;
  }
  const parsed = itemPatchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "That change couldn't be saved as sent." }, { status: 400 });
  }

  const ifMatch = request.headers.get("if-match") ?? undefined;

  // Scoped to the collection the role was checked against: an item id from any
  // other collection is "not found" here, never written through this one.
  const result = await patchItem(id, itemId, parsed.data, ifMatch);

  if (!result.ok && result.reason === "not_found") {
    return NextResponse.json({ error: "Item not found." }, { status: 404 });
  }
  if (!result.ok && result.reason === "conflict") {
    return NextResponse.json(
      { error: "This item changed elsewhere.", current: result.current },
      { status: 409 },
    );
  }
  if (result.ok) return NextResponse.json(result.item);
  return NextResponse.json({ error: "Unknown error." }, { status: 500 });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  const { id, itemId } = await params;
  const guard = await requireRole(request, id, ["owner", "editor"]);
  if (isGuardResponse(guard)) return guard;

  // Same scoping as PATCH. An item outside this collection is left alone and
  // the answer is the same 204 an already-deleted item gets, so the response
  // says nothing about ids in collections the caller can't see.
  await deleteItem(id, itemId);
  return new NextResponse(null, { status: 204 });
}
