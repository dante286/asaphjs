import { NextResponse } from "next/server";
import { isGuardResponse, requireRole } from "@/lib/auth/api-guard";
import { createItem, listItems, stripItemsForPublic } from "@/db/queries/items";
import { getCollectionById } from "@/db/queries/collections";

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

  const body = await request.json();
  const title = String(body.title ?? "").trim();
  if (!title) return NextResponse.json({ error: "Title is required." }, { status: 400 });

  const item = await createItem({ collectionId: id, title, values: body.values ?? {} });
  return NextResponse.json(item, { status: 201 });
}
