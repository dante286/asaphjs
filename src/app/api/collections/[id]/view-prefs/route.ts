import { NextResponse } from "next/server";
import { isGuardResponse, requireRole } from "@/lib/auth/api-guard";
import { z } from "zod";
import { getViewPreferences, upsertViewPreferences } from "@/db/queries/view-preferences";
import { readJsonBody } from "@/lib/api/json-body";

/** A layout is a handful of widths and hidden column ids; this is far more than any real one. */
const VIEW_PREFS_MAX_BYTES = 64 * 1024;

const columnId = z.string().min(1).max(200);

/**
 * Parsed rather than passed through: the patch is stored as jsonb, so without
 * this a client could put anything of any size in it. Widths are whole pixels
 * in a sane range (the table's own minimum is 72); `null` clears one.
 */
const viewPrefsPatchSchema = z.object({
  columnWidths: z.record(columnId, z.number().int().min(20).max(4000).nullable()).optional(),
  hiddenColumns: z.array(columnId).max(500).optional(),
  resetColumnWidths: z.boolean().optional(),
});

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

  const body = await readJsonBody(request, VIEW_PREFS_MAX_BYTES);
  if (!body.ok) return body.response;
  const parsed = viewPrefsPatchSchema.safeParse(body.value);
  if (!parsed.success) {
    return NextResponse.json({ error: "Those view preferences couldn't be saved as sent." }, { status: 400 });
  }

  return NextResponse.json(await upsertViewPreferences(guard.userId!, id, parsed.data));
}
