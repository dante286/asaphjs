import { expect, test } from "@playwright/test";

/**
 * The headers from `proxy.ts` and `next.config.ts`, against the production
 * build. Only a real server proves the nonce Next tags its scripts with is the
 * one in the header. If it weren't, every page would load with its JavaScript
 * blocked and look fine until someone clicked something.
 */

test("a page carries a CSP whose nonce its own scripts use", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (/Content Security Policy/i.test(message.text())) violations.push(message.text());
  });

  const response = await page.goto("/auth");
  const csp = response?.headers()["content-security-policy"] ?? "";
  const nonce = csp.match(/'nonce-([^']+)'/)?.[1];

  expect(nonce).toBeTruthy();
  expect(csp).toContain("frame-ancestors 'none'");
  const scriptNonces = await page.locator("script[nonce]").evaluateAll((scripts) =>
    scripts.map((s) => (s as HTMLScriptElement).nonce),
  );
  expect(scriptNonces.length).toBeGreaterThan(0);
  expect(new Set(scriptNonces)).toEqual(new Set([nonce]));

  // Hydrated, not just painted: the segmented control is a client component.
  await page.getByText("Create account", { exact: true }).first().click();
  await expect(page.locator('input[name="confirmPassword"]')).toBeVisible();
  expect(violations).toEqual([]);
});

test("a fresh nonce on every response", async ({ request }) => {
  const nonceOf = async () =>
    ((await request.get("/auth")).headers()["content-security-policy"] ?? "").match(/'nonce-([^']+)'/)?.[1];
  expect(await nonceOf()).not.toEqual(await nonceOf());
});

test("the static headers, and no Referer from a token page", async ({ request }) => {
  const headers = (await request.get("/auth")).headers();
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");

  const share = (await request.get("/s/definitely-not-a-real-share-token")).headers();
  expect(share["referrer-policy"]).toBe("no-referrer");
});
