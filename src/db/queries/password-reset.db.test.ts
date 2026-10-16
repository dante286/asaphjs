import { like } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { verification } from "@/db/schema";
import { shouldSendReset } from "./password-reset";

/**
 * The reset cooldown at the row level. `src/actions/auth.db.test.ts` drives it
 * through the real Better Auth flow; what that can't do is make two requests
 * genuinely overlap — in one process, the first finishes before the second has
 * written its row. Here both rows exist before either decision is made, which is
 * the case the ordering exists for.
 */

const USER = "user-under-test";

async function aResetRow(token: string, createdAt: Date, value = USER) {
  await db.insert(verification).values({
    id: `id-${token}`,
    identifier: `reset-password:${token}`,
    value,
    expiresAt: new Date(createdAt.getTime() + 60 * 60 * 1000),
    createdAt,
  });
}

function remainingTokens() {
  return db
    .select({ identifier: verification.identifier })
    .from(verification)
    .where(like(verification.identifier, "reset-password:%"))
    .then((rows) => rows.map((row) => row.identifier.slice("reset-password:".length)).sort());
}

describe("shouldSendReset", () => {
  it("sends the only request there is", async () => {
    await aResetRow("a", new Date());

    expect(await shouldSendReset(USER, "a")).toBe(true);
  });

  it("holds back a request made inside the minute, and drops its token", async () => {
    await aResetRow("a", new Date(Date.now() - 30_000));
    await aResetRow("b", new Date());

    expect(await shouldSendReset(USER, "b")).toBe(false);
    expect(await remainingTokens()).toEqual(["a"]);
  });

  it("isn't held back by a request that came after it", async () => {
    // Two overlapping requests: the second has written its row by the time the
    // first decides. Counting any other row in the window as a reason to wait
    // would have each hold the other back — a double-clicked button that sends
    // nothing.
    await aResetRow("a", new Date(Date.now() - 1_000));
    await aResetRow("b", new Date());

    expect(await shouldSendReset(USER, "a")).toBe(true);
    expect(await shouldSendReset(USER, "b")).toBe(false);
  });

  it("breaks a same-instant tie the same way from both sides", async () => {
    const now = new Date();
    await aResetRow("a", now);
    await aResetRow("b", now);

    // By id, so the two requests agree on which of them is first.
    expect(await shouldSendReset(USER, "a")).toBe(true);
    expect(await shouldSendReset(USER, "b")).toBe(false);
    expect(await remainingTokens()).toEqual(["a"]);
  });

  it("isn't held back by a request from over a minute ago", async () => {
    await aResetRow("a", new Date(Date.now() - 61_000));
    await aResetRow("b", new Date());

    expect(await shouldSendReset(USER, "b")).toBe(true);
  });

  it("isn't held back by someone else's request", async () => {
    await aResetRow("a", new Date(Date.now() - 1_000), "someone-else");
    await aResetRow("b", new Date());

    expect(await shouldSendReset(USER, "b")).toBe(true);
  });

  it("sends nothing for a token that's already gone", async () => {
    expect(await shouldSendReset(USER, "consumed")).toBe(false);
  });
});
