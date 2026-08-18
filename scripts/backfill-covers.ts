import { config } from "dotenv";

// Same reason as scripts/seed/run.ts: load env here, not via a POSIX-only
// `-r dotenv/config` prefix on the npm script.
config({ path: ".env.local" });

/**
 * Copies already-matched items' provider cover art into local storage, for
 * covers that were stored before their provider's host was mirrorable.
 *
 *   npm run covers:backfill                              # dry run, every collection
 *   npm run covers:backfill -- --apply                   # actually write
 *   npm run covers:backfill -- --collection=tv-shows --apply
 *   npm run covers:backfill -- --host=image.tmdb.org --limit=25 --apply
 *
 * Re-running a lookup does NOT fix these: buildPrefillPlan only patches
 * coverUrl when the hydrated URL differs from the stored one, and for an item
 * still pointing at the provider those are the same string, so mirrorCover is
 * never reached. Hence a script rather than a note telling people to re-match.
 *
 * Dry run by default because this rewrites rows in someone's collection. It
 * writes cover_url only, leaving updated_at alone — where the bytes live isn't
 * an edit to the item, and bumping it would push every backfilled row to the
 * top of "recently updated" and break any open editor's if-match.
 */
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const flag = (name: string): string | undefined =>
  args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

const ONLY_COLLECTION = flag("collection");
const ONLY_HOST = flag("host");
const LIMIT = Number(flag("limit") ?? 0) || Infinity;

type Outcome = "mirrored" | "unmirrorable" | "failed" | "skipped";

function shortenUrl(url: string, width = 52): string {
  return url.length <= width ? url : `${url.slice(0, width - 1)}…`;
}

async function main() {
  const { and, eq, isNotNull, like, not } = await import("drizzle-orm");
  // Dynamic, like the seed script: db/client.ts reads DATABASE_URL at module eval.
  const { db } = await import("@/db/client");
  const { collections, items } = await import("@/db/schema");
  const { mirrorCover, isMirrorableCoverUrl } = await import("@/lib/metadata/cover-mirror");
  const { UPLOAD_URL_PREFIX } = await import("@/lib/uploads/urls");

  let collectionId: string | undefined;
  if (ONLY_COLLECTION) {
    const found = await db.query.collections.findFirst({
      where: eq(collections.slug, ONLY_COLLECTION),
    });
    if (!found) {
      console.error(`No collection with slug "${ONLY_COLLECTION}".`);
      process.exit(1);
    }
    collectionId = found.id;
  }

  const rows = await db
    .select({ id: items.id, title: items.title, coverUrl: items.coverUrl, collectionId: items.collectionId })
    .from(items)
    .where(
      and(
        isNotNull(items.coverUrl),
        // Anything already local is done — this is what makes reruns cheap.
        not(like(items.coverUrl, `${UPLOAD_URL_PREFIX}%`)),
        ...(collectionId ? [eq(items.collectionId, collectionId)] : []),
      ),
    );

  const candidates = rows.filter((r) => !ONLY_HOST || (r.coverUrl ?? "").includes(ONLY_HOST));
  const targeted = candidates.slice(0, LIMIT === Infinity ? undefined : LIMIT);

  console.log(
    `${rows.length} item(s) with a non-local cover` +
      (ONLY_COLLECTION ? ` in "${ONLY_COLLECTION}"` : "") +
      (ONLY_HOST ? `, ${candidates.length} matching host ${ONLY_HOST}` : "") +
      (targeted.length < candidates.length ? `, taking ${targeted.length} (--limit)` : "") +
      `.\n${APPLY ? "Applying." : "Dry run — pass --apply to write."}\n`,
  );

  const tally: Record<Outcome, number> = { mirrored: 0, unmirrorable: 0, failed: 0, skipped: 0 };

  for (const row of targeted) {
    const url = row.coverUrl!;
    const label = `${row.title.slice(0, 28).padEnd(28)} ${shortenUrl(url)}`;

    if (!isMirrorableCoverUrl(url)) {
      // Someone's own pasted URL, or a provider whose host isn't in COVER_HOSTS.
      tally.unmirrorable += 1;
      console.log(`  SKIP  ${label}  (no provider owns this host)`);
      continue;
    }

    if (!APPLY) {
      tally.skipped += 1;
      console.log(`  WOULD ${label}`);
      continue;
    }

    const mirrored = await mirrorCover(url);
    if (!mirrored) {
      // mirrorCover swallows its own failures by design — the item keeps the
      // provider URL and stays a candidate for the next run.
      tally.failed += 1;
      console.log(`  FAIL  ${label}  (fetch or re-encode failed; left as-is)`);
      continue;
    }

    await db.update(items).set({ coverUrl: mirrored }).where(eq(items.id, row.id));
    tally.mirrored += 1;
    console.log(`  OK    ${label}  ->  ${mirrored}`);
  }

  console.log(
    `\n${APPLY ? "Mirrored" : "Would mirror"} ${APPLY ? tally.mirrored : tally.skipped}` +
      `, ${tally.unmirrorable} not mirrorable` +
      (tally.failed ? `, ${tally.failed} failed (rerun to retry)` : "") +
      ".",
  );
  process.exit(tally.failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
