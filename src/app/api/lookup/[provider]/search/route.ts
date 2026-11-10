import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { providerKeySchema } from "@/lib/metadata/types";
import { getProvider } from "@/lib/metadata/providers";
import { isProviderConfigured } from "@/lib/metadata/lookup-config";
import { MIN_LOOKUP_QUERY_LENGTH } from "@/lib/api/lookup-client";
import { hitRateLimit } from "@/db/queries/auth-rate-limits";
import { LimiterBusyError } from "@/lib/metadata/limiter-busy";

const LOOKUP_WINDOW_SECONDS = 60;
const LOOKUP_MAX_PER_WINDOW = 30;

export async function GET(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authorized." }, { status: 401 });

  const { provider: providerParam } = await params;
  const parsed = providerKeySchema.safeParse(providerParam);
  if (!parsed.success) return NextResponse.json({ error: "Unknown provider." }, { status: 400 });

  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < MIN_LOOKUP_QUERY_LENGTH) {
    return NextResponse.json(
      { error: `q must be at least ${MIN_LOOKUP_QUERY_LENGTH} characters.` },
      { status: 400 },
    );
  }

  if (!isProviderConfigured(parsed.data)) {
    return NextResponse.json({ error: "That provider isn't configured." }, { status: 503 });
  }

  // Per person, so nobody can spend the instance's shared provider quota (and
  // queue) on their own. Searches are one per button press; this is generous.
  if ((await hitRateLimit(`lookup:user:${session.user.id}`, LOOKUP_WINDOW_SECONDS)) > LOOKUP_MAX_PER_WINDOW) {
    return NextResponse.json({ error: "That's a lot of lookups. Wait a minute and try again." }, { status: 429 });
  }

  try {
    return NextResponse.json(await getProvider(parsed.data).search(q));
  } catch (err) {
    if (err instanceof LimiterBusyError) {
      return NextResponse.json({ error: "Lookups are busy right now. Try again in a minute." }, { status: 503 });
    }
    // A provider being down or rate-limiting us is not a 500 in this app's terms
    // — the picker shows the message and the owner can still type values in.
    console.error(`[lookup] ${parsed.data} search failed`, err);
    return NextResponse.json({ error: "The metadata provider didn't answer. Try again." }, { status: 502 });
  }
}
