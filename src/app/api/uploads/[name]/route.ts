import { NextResponse } from "next/server";
import { readUpload } from "@/lib/uploads/store";

/**
 * Deliberately unauthenticated: covers are rendered by `<img>` on public share
 * pages (`/s/:token`), which carry no session. The random filename is the
 * capability — see the uploads note in the README.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const file = await readUpload(name);
  if (!file) return new NextResponse(null, { status: 404 });

  return new NextResponse(new Blob([file.bytes], { type: file.mime }), {
    headers: {
      "Content-Type": file.mime,
      "Content-Length": String(file.bytes.byteLength),
      // Names are random and never reused, so the bytes behind a URL can't change.
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
