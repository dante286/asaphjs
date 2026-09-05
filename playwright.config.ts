import { defineConfig, devices } from "@playwright/test";

/**
 * The smoke tier. Four specs, one browser, and the only tier that needs a
 * running server — see the "The smoke tier" section of the README for what
 * belongs here and, more to the point, what doesn't.
 *
 * Two ways to run it, one suite:
 *
 *   npm run build && npm run test:e2e   — against `.next/standalone` locally
 *   E2E_BASE_URL=... npx playwright test — against something already running
 *
 * The second is how CI points these at the built container image, and how
 * `docker compose up` can be smoke-tested by hand. When it's set, the
 * `webServer` block below drops out and Playwright starts nothing.
 */

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  // Each spec signs up its own throwaway account, so parallel workers share a
  // database without sharing any state. Two rather than the default
  // core-count-based number: the bottleneck is one Next server, and more workers
  // just queue behind it while making the failure output harder to read.
  workers: process.env.CI ? 2 : undefined,
  forbidOnly: Boolean(process.env.CI),
  /**
   * One retry in CI, none locally. Worth being clear about what this can and
   * can't hide: the failure this tier exists to catch — a photo route that
   * throws ERR_DLOPEN_FAILED because libvips fell out of the standalone trace —
   * is deterministic and fails the retry identically. The retry is for browser
   * and container timing, which is the only flake a four-spec suite has left.
   */
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never" }]]
    : [["list"]],
  use: {
    baseURL,
    // Only on a failure, and only kept for one: a trace is a few MB and the
    // point of uploading the report at all is the run that went red.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  /**
   * Chromium only. A cross-browser matrix triples the slowest tier in the
   * repo to re-answer a question none of these four specs ask — every one of
   * them is about whether the server, the image and the standalone trace are
   * intact, not about how a browser lays the page out.
   */
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "node scripts/e2e/standalone-server.mjs",
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        stdout: "pipe",
        stderr: "pipe",
      },
});
