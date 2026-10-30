import { describe, expect, it } from "vitest";
import { createTestUser } from "@/test/db/fixtures";
import { inviteToRegister, listPendingInvites, MAX_PENDING_INVITES } from "./registration-invites";

/**
 * The query under the Invite someone card. Most of its rules are pinned through
 * the action in `src/actions/registration-invites.db.test.ts`; this is the one
 * that needs the query called bare, with nothing in front of it to stagger the
 * calls: the cap holding under concurrency, which is the advisory lock's job.
 */
describe("inviteToRegister", () => {
  it("never lets concurrent invites past the cap", async () => {
    const me = await createTestUser();

    const results = await Promise.all(
      Array.from({ length: MAX_PENDING_INVITES + 3 }, (_, i) =>
        inviteToRegister({ email: `guest-${i}@asaph.test`, invitedBy: me.id }),
      ),
    );

    expect(results.filter((r) => r.ok)).toHaveLength(MAX_PENDING_INVITES);
    expect(await listPendingInvites(me.id)).toHaveLength(MAX_PENDING_INVITES);
  });
});
