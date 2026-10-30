import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { passwordResetAvailable } from "./password-reset";

const VARS = ["BETTER_AUTH_URL", "SMTP_HOST", "EMAIL_FROM"];

beforeEach(() => {
  for (const name of VARS) vi.stubEnv(name, undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
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
