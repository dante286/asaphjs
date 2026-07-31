import { NextResponse } from "next/server";
import { isGuardResponse, requireRole } from "@/lib/auth/api-guard";
import { deleteItem, patchItem } from "@/db/queries/items";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  const { id, itemId } = await params;
  const guard = await requireRole(request, id, ["owner", "editor"]);
  if (isGuardResponse(guard)) return guard;

  const body = await request.json();
  const ifMatch = request.headers.get("if-match") ?? undefined;

  const result = await patchItem(itemId, body, ifMatch);

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

  await deleteItem(itemId);
  return new NextResponse(null, { status: 204 });
}
