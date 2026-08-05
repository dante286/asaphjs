import { NextResponse } from "next/server";
import { isGuardResponse, requireRole } from "@/lib/auth/api-guard";
import { getViewPreferences, upsertViewPreferences } from "@/db/queries/view-preferences";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await requireRole(request, id, ["owner", "editor", "viewer"]);
  if (isGuardResponse(guard)) return guard;

  if (!guard.userId) return NextResponse.json({ columnWidths: {}, hiddenColumns: [] });
  return NextResponse.json(await getViewPreferences(guard.userId, id));
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await requireRole(request, id, ["owner", "editor", "viewer"]);
  if (isGuardResponse(guard)) return guard;

  const body = await request.json();

  // Public/token access has no account to key a personal layout on — accept
  // the request but don't persist anything, rather than erroring in the UI.
  if (!guard.userId) return NextResponse.json({ columnWidths: {}, hiddenColumns: [] });

  return NextResponse.json(await upsertViewPreferences(guard.userId, id, body));
}
