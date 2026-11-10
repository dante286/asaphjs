import { afterEach, describe, expect, it, vi } from "vitest";
import {
  contentSecurityPolicy,
  cspHeaderName,
  servedOverHttps,
  STATIC_SECURITY_HEADERS,
} from "./security-headers";

afterEach(() => vi.unstubAllEnvs());

function directives(policy: string): Map<string, string> {
  return new Map(
    policy.split("; ").map((d) => {
      const [name, ...rest] = d.split(" ");
      return [name, rest.join(" ")];
    }),
  );
}

describe("contentSecurityPolicy", () => {
  it("lets scripts run only with this request's nonce", () => {
    const csp = directives(contentSecurityPolicy({ nonce: "abc123", dev: false, https: true }));

    expect(csp.get("script-src")).toBe("'self' 'nonce-abc123' 'strict-dynamic'");
    expect(csp.get("object-src")).toBe("'none'");
    expect(csp.get("frame-ancestors")).toBe("'none'");
    expect(csp.get("base-uri")).toBe("'self'");
  });

  it("allows eval in development only", () => {
    expect(contentSecurityPolicy({ nonce: "n", dev: true, https: false })).toContain("'unsafe-eval'");
    expect(contentSecurityPolicy({ nonce: "n", dev: false, https: false })).not.toContain("'unsafe-eval'");
  });

  it("keeps a nonce out of style-src, where it would switch off 'unsafe-inline'", () => {
    // React style props are attributes; a nonce can't cover them, and its
    // presence makes browsers ignore 'unsafe-inline' — every styled element
    // would lose its styles.
    const styles = directives(contentSecurityPolicy({ nonce: "n", dev: false, https: true })).get("style-src");
    expect(styles).toContain("'unsafe-inline'");
    expect(styles).not.toContain("nonce");
  });

  it("allows the provider image hosts covers still load from", () => {
    const images = directives(contentSecurityPolicy({ nonce: "n", dev: false, https: true })).get("img-src");
    // archive.org and its storage nodes: Open Library's covers redirect through both.
    for (const host of [
      "https://images.igdb.com",
      "https://image.tmdb.org",
      "https://covers.openlibrary.org",
      "https://archive.org",
      "https://*.archive.org",
    ]) {
      expect(images).toContain(host);
    }
  });

  it("upgrades insecure requests only on an https instance", () => {
    expect(contentSecurityPolicy({ nonce: "n", dev: false, https: true })).toContain("upgrade-insecure-requests");
    expect(contentSecurityPolicy({ nonce: "n", dev: false, https: false })).not.toContain("upgrade-insecure-requests");
  });
});

describe("servedOverHttps", () => {
  it("follows BETTER_AUTH_URL, not the request", () => {
    vi.stubEnv("BETTER_AUTH_URL", "https://asaph.example.com");
    expect(servedOverHttps()).toBe(true);
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
    expect(servedOverHttps()).toBe(false);
    vi.stubEnv("BETTER_AUTH_URL", "");
    expect(servedOverHttps()).toBe(false);
  });
});

describe("cspHeaderName", () => {
  it("switches to report-only for the literal true only", () => {
    expect(cspHeaderName()).toBe("Content-Security-Policy");
    vi.stubEnv("CSP_REPORT_ONLY", "true");
    expect(cspHeaderName()).toBe("Content-Security-Policy-Report-Only");
    vi.stubEnv("CSP_REPORT_ONLY", "yes");
    expect(cspHeaderName()).toBe("Content-Security-Policy");
  });
});

describe("STATIC_SECURITY_HEADERS", () => {
  it("denies framing and MIME sniffing", () => {
    expect(STATIC_SECURITY_HEADERS).toEqual(
      expect.arrayContaining([
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
      ]),
    );
  });
});
