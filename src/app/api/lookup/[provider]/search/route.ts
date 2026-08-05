import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { providerKeySchema } from "@/lib/metadata/types";
import { getProvider } from "@/lib/metadata/providers";

export async function GET(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authorized." }, { status: 401 });

  const { provider: providerParam } = await params;
  const parsed = providerKeySchema.safeParse(providerParam);
  if (!parsed.success) return NextResponse.json({ error: "Unknown provider." }, { status: 400 });

  const q = new URL(request.url).searchParams.get("q");
  if (!q) return NextResponse.json({ error: "q is required." }, { status: 400 });

  return NextResponse.json(await getProvider(parsed.data).search(q));
}
