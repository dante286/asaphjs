import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { passwordResetAvailable, resetLinkOrigin } from "./password-reset";

const VARS = ["BETTER_AUTH_URL", "SMTP_HOST", "EMAIL_FROM"];

beforeEach(() => {
  for (const name of VARS) vi.stubEnv(name, undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resetLinkOrigin", () => {
  it("is the origin of BETTER_AUTH_URL", () => {
    vi.stubEnv("BETTER_AUTH_URL", "https://asaph.example.com");

    expect(resetLinkOrigin()).toBe("https://asaph.example.com");
  });

  it("drops a path or trailing slash, since the reset page lives at the root", () => {
    vi.stubEnv("BETTER_AUTH_URL", " https://asaph.example.com/api/auth/ ");

    expect(resetLinkOrigin()).toBe("https://asaph.example.com");
  });

  it("is null when unset, so there's no falling back to the request's own host", () => {
    // The fallback is the vulnerability: a forged Host or X-Forwarded-Host would
    // put a live reset token on someone else's domain.
    expect(resetLinkOrigin()).toBeNull();
  });

  it("is null for something that isn't an http(s) URL", () => {
    for (const value of ["asaph.example.com", "javascript:alert(1)", "ftp://asaph.example.com"]) {
      vi.stubEnv("BETTER_AUTH_URL", value);
      expect(resetLinkOrigin()).toBeNull();
    }
  });
});

describe("passwordResetAvailable", () => {
  it("needs mail and an origin both", () => {
    expect(passwordResetAvailable()).toBe(false);

    vi.stubEnv("SMTP_HOST", "smtp.example.com");
    vi.stubEnv("EMAIL_FROM", "asaph@example.com");
    expect(passwordResetAvailable()).toBe(false);

    vi.stubEnv("BETTER_AUTH_URL", "https://asaph.example.com");
    expect(passwordResetAvailable()).toBe(true);

    vi.stubEnv("SMTP_HOST", undefined);
    expect(passwordResetAvailable()).toBe(false);
  });
});
