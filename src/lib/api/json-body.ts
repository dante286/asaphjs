import { NextResponse } from "next/server";

/**
 * Route handlers have no body size limit of their own (Server Actions have
 * `serverActions.bodySizeLimit`), so a JSON endpoint that calls
 * `request.json()` will buffer and parse whatever it's sent. This reads at most
 * `maxBytes`, refusing early on a declared `Content-Length` and again on the
 * text actually received, and answers 413 or 400 in the endpoint's own words.
 *
 * Returns the parsed value, or the response to send instead.
 */
export async function readJsonBody(
  request: Request,
  maxBytes: number,
): Promise<{ ok: true; value: unknown } | { ok: false; response: NextResponse }> {
  const tooLarge = () => ({
    ok: false as const,
    response: NextResponse.json({ error: "That request is too large." }, { status: 413 }),
  });

  if (Number(request.headers.get("content-length") ?? 0) > maxBytes) return tooLarge();
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) return tooLarge();

  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, response: NextResponse.json({ error: "That request isn't valid JSON." }, { status: 400 }) };
  }
}
