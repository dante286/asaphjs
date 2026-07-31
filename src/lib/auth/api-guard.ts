import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth";
import { resolveRole } from "@/db/queries/members";
import type { Role } from "@/types";

export async function requireRole(
  request: Request,
  collectionId: string,
  allowed: Role[],
): Promise<{ userId: string | null; role: Role } | NextResponse> {
  const session = await auth.api.getSession({ headers: request.headers });
  const url = new URL(request.url);
  const token = url.searchParams.get("token");

  const role = await resolveRole(collectionId, session?.user.id ?? null, token);
  if (!role || !allowed.includes(role)) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }
  return { userId: session?.user.id ?? null, role };
}

export function isGuardResponse(x: unknown): x is NextResponse {
  return x instanceof NextResponse;
}
