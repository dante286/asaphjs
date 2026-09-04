import { afterEach, describe, expect, it, vi } from "vitest";
import { signupsAllowed } from "./signups";

// Every case stubs the variable rather than reading whatever the developer
// happens to have exported, so the suite says the same thing on a machine with
// a populated .env as it does in a clean checkout.
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("signupsAllowed", () => {
  it("is open when the variable is unset", () => {
    vi.stubEnv("ALLOW_SIGNUPS", undefined);

    expect(signupsAllowed()).toBe(true);
  });

  it.each(["false", "FALSE", "  False  "])("is closed for %j", (value) => {
    vi.stubEnv("ALLOW_SIGNUPS", value);

    expect(signupsAllowed()).toBe(false);
  });

  it.each(["true", "TRUE", "1", "yes"])("is open for %j", (value) => {
    vi.stubEnv("ALLOW_SIGNUPS", value);

    expect(signupsAllowed()).toBe(true);
  });

  // The asymmetry is deliberate and is the whole point of the module: only the
  // literal `false` closes the door. A typo leaving signups open is recoverable
  // by fixing the typo; a typo locking out an operator who has no account yet
  // means editing env and redeploying to get back in.
  it.each(["fasle", "no", "0", "off", "", "   "])(
    "leaves signups open for the near-miss %j",
    (value) => {
      vi.stubEnv("ALLOW_SIGNUPS", value);

      expect(signupsAllowed()).toBe(true);
    },
  );
});
