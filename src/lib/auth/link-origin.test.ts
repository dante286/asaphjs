import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { trustedLinkOrigin } from "./link-origin";

beforeEach(() => {
  vi.stubEnv("BETTER_AUTH_URL", undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("trustedLinkOrigin", () => {
  it("is the origin of BETTER_AUTH_URL", () => {
    vi.stubEnv("BETTER_AUTH_URL", "https://asaph.example.com");

    expect(trustedLinkOrigin()).toBe("https://asaph.example.com");
  });

  it("drops a path or trailing slash, since the pages it links to live at the root", () => {
    vi.stubEnv("BETTER_AUTH_URL", " https://asaph.example.com/api/auth/ ");

    expect(trustedLinkOrigin()).toBe("https://asaph.example.com");
  });

  it("is null when unset, so there's no falling back to the request's own host", () => {
    // The fallback is the vulnerability: a forged Host or X-Forwarded-Host would
    // put a live reset or invite token on someone else's domain.
    expect(trustedLinkOrigin()).toBeNull();
  });

  it("is null for something that isn't an http(s) URL", () => {
    for (const value of ["asaph.example.com", "javascript:alert(1)", "ftp://asaph.example.com"]) {
      vi.stubEnv("BETTER_AUTH_URL", value);
      expect(trustedLinkOrigin()).toBeNull();
    }
  });
});
