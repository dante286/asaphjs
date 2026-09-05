import { NextResponse } from "next/server";
import { isGuardResponse, requireRole } from "@/lib/auth/api-guard";
import { getViewPreferences, upsertViewPreferences } from "@/db/queries/view-preferences";

/**
 * A personal layout is keyed on the caller's own id, so every handler here
 * needs one. `public` is the only role `requireRole` grants without a session
 * behind it, and it is deliberately absent from the `allowed` lists below —
 * which is what makes `guard.userId` a real id rather than a maybe.
 */

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await requireRole(request, id, ["owner", "editor", "viewer"]);
  if (isGuardResponse(guard)) return guard;

  return NextResponse.json(await getViewPreferences(guard.userId!, id));
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await requireRole(request, id, ["owner", "editor", "viewer"]);
  if (isGuardResponse(guard)) return guard;

  const body = await request.json();

  return NextResponse.json(await upsertViewPreferences(guard.userId!, id, body));
}
