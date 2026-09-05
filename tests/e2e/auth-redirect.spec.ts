import { expect, test } from "@playwright/test";

/**
 * `middleware.ts` is the one file in this repo that nothing else can prove is
 * wired into the production build. It isn't imported by a route, it doesn't
 * appear in a trace anyone reads, and a build that dropped it would be green
 * everywhere else while leaving every protected page open to anyone who typed
 * its address.
 *
 * The redirect target carries the path back as `?next=`, so `/auth` can return
 * you where you were aiming. `URLSearchParams` percent-encodes the slashes,
 * which is what the expectations below spell out rather than glossing over.
 */

const PROTECTED = ["/", "/collections/anything-at-all", "/account"];

for (const pathname of PROTECTED) {
  test(`a signed-out visit to ${pathname} lands on the sign-in page`, async ({ page }) => {
    await page.goto(pathname);

    await expect(page).toHaveURL(`/auth?next=${encodeURIComponent(pathname)}`);
    // The form, not just the address: a redirect to a page that then failed to
    // render would still satisfy the URL check.
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  });
}

test("a path outside the matcher is served without a session", async ({ page }) => {
  // The counterpart assertion, and the reason the matcher is a list rather than
  // a catch-all: /s/:token has to stay reachable signed out or the share links
  // the previous spec exercises would all bounce to /auth. An unknown token is
  // a 404 from the page itself — which is a response, not a redirect.
  const response = await page.goto("/s/definitely-not-a-real-share-token");

  expect(response?.status()).toBe(404);
  await expect(page).toHaveURL("/s/definitely-not-a-real-share-token");
});
