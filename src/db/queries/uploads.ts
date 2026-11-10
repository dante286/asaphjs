import { and, inArray, not, type SQL } from "drizzle-orm";
import { db } from "@/db/client";
import { items } from "@/db/schema";
import { deleteUploads } from "@/lib/uploads/files";
import { isManagedUpload } from "@/lib/uploads/urls";

/**
 * Unlinks the managed upload files among `urls` that no item still names, and
 * returns how many it removed. Every path that deletes a cover the database
 * pointed at goes through this rather than `deleteUploads` directly.
 *
 * Today each upload belongs to exactly one item: covers are minted server-side
 * with a fresh random name and can't be set from a client. Before that was
 * enforced, an editor could point an item at someone else's upload, and the
 * next photo change or delete on *their* item would unlink a file another item
 * still showed. Rows written then may still share a file, so the reference is
 * checked rather than assumed.
 *
 * `ignore` excludes rows from the check that are about to be deleted but still
 * exist, which is how the account-deletion sweep runs (before Better Auth's
 * cascade). Called after a row's own update or delete otherwise, so that row
 * no longer counts.
 */
export async function releaseUploads(urls: Array<string | null | undefined>, ignore?: SQL): Promise<number> {
  const managed = [...new Set(urls.filter(isManagedUpload))];
  if (managed.length === 0) return 0;

  const referenced = inArray(items.coverUrl, managed);
  const stillUsed = await db
    .select({ coverUrl: items.coverUrl })
    .from(items)
    .where(ignore ? and(referenced, not(ignore)) : referenced);
  const keep = new Set(stillUsed.map((row) => row.coverUrl));

  return deleteUploads(managed.filter((url) => !keep.has(url)));
}
