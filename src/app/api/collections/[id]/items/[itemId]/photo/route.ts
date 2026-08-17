import { NextResponse } from "next/server";
import { isGuardResponse, requireRole } from "@/lib/auth/api-guard";
import { getItem, patchItem, type PatchResult } from "@/db/queries/items";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from "@/lib/uploads/limits";
import { deleteUpload, saveUpload } from "@/lib/uploads/store";

// Multipart framing adds a little on top of the file itself; the authoritative
// check is on the decoded part below.
const MAX_REQUEST_BYTES = MAX_UPLOAD_BYTES + 64 * 1024;

function patchFailure(result: Exclude<PatchResult, { ok: true }>) {
  if (result.reason === "conflict") {
    return NextResponse.json(
      { error: "This item changed elsewhere.", current: result.current },
      { status: 409 },
    );
  }
  return NextResponse.json({ error: "Item not found." }, { status: 404 });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  const { id, itemId } = await params;
  const guard = await requireRole(request, id, ["owner", "editor"]);
  if (isGuardResponse(guard)) return guard;

  const item = await getItem(itemId);
  if (!item || item.collectionId !== id) {
    return NextResponse.json({ error: "Item not found." }, { status: 404 });
  }

  // Bail before buffering the body when the client already told us it's too big.
  if (Number(request.headers.get("content-length") ?? 0) > MAX_REQUEST_BYTES) {
    return NextResponse.json({ error: `Photos are capped at ${MAX_UPLOAD_MB}MB.` }, { status: 413 });
  }

  const form = await request.formData();
  const photo = form.get("photo");
  if (!(photo instanceof File) || photo.size === 0) {
    return NextResponse.json({ error: "No photo in the request." }, { status: 400 });
  }
  if (photo.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: `Photos are capped at ${MAX_UPLOAD_MB}MB.` }, { status: 413 });
  }

  const saved = await saveUpload(new Uint8Array(await photo.arrayBuffer()));
  if (!saved) {
    return NextResponse.json(
      { error: "That file isn't a readable JPEG, PNG, WebP, GIF, or AVIF image." },
      { status: 415 },
    );
  }

  const result = await patchItem(itemId, { coverUrl: saved }, request.headers.get("if-match") ?? undefined);
  if (!result.ok) {
    // The row moved out from under us — don't leave the bytes orphaned on disk.
    await deleteUpload(saved);
    return patchFailure(result);
  }

  // No-op unless the previous cover was itself an upload (provider URLs are left alone).
  await deleteUpload(item.coverUrl);
  return NextResponse.json(result.item);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  const { id, itemId } = await params;
  const guard = await requireRole(request, id, ["owner", "editor"]);
  if (isGuardResponse(guard)) return guard;

  const item = await getItem(itemId);
  if (!item || item.collectionId !== id) {
    return NextResponse.json({ error: "Item not found." }, { status: 404 });
  }

  const result = await patchItem(itemId, { coverUrl: null }, request.headers.get("if-match") ?? undefined);
  if (!result.ok) return patchFailure(result);

  await deleteUpload(item.coverUrl);
  return NextResponse.json(result.item);
}
