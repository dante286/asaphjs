import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { authRateLimits } from "@/db/schema";
import { clearRateLimit, hitRateLimit } from "@/db/queries/auth-rate-limits";
import { createTestUser, TEST_PASSWORD, type TestUser } from "@/test/db/fixtures";

/**
 * The attempt limits on sign-in and the other password-checking endpoints.
 *
 * The thing worth pinning is *where* they run: Better Auth's own limiter only
 * sees HTTP requests, and the forms call `auth.api.*` from Server Actions, so a
 * limit that only covered one of those paths would be no limit at all. Both are
 * exercised below, against the same counters.
 */

/** What the mocked `next/headers` reports as the client's address. */
const client = vi.hoisted(() => ({ ip: "198.51.100.7" }));
vi.mock("next/headers", async () => ({
  headers: async () => new Headers({ "x-forwarded-for": client.ip }),
}));

const { auth } = await import("./auth");
const { AUTH_LIMITS, TOO_MANY_ATTEMPTS, clientIp, ipAddressOptions, limitAuthAttempt } = await import("./rate-limit");
const actions = await import("@/actions/auth");

let owner: TestUser;

beforeEach(async () => {
  owner = await createTestUser();
  client.ip = "198.51.100.7";
});

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

function signIn(password: string, email = owner.email) {
  return actions.signInAction(undefined, form({ email, password })).catch((thrown: { digest?: string }) => {
    // A redirect is how a successful sign-in ends.
    if (thrown.digest?.startsWith("NEXT_REDIRECT")) return { signedIn: true as const };
    throw thrown;
  });
}

const LIMITED = { error: "Too many attempts. Wait a few minutes and try again." };

describe("hitRateLimit", () => {
  it("counts every hit in the window", async () => {
    expect(await hitRateLimit("k", 60)).toBe(1);
    expect(await hitRateLimit("k", 60)).toBe(2);
    expect(await hitRateLimit("other", 60)).toBe(1);
  });

  it("gives concurrent hits distinct counts", async () => {
    // The point of doing it in one upsert: a burst can't all read the same count.
    const counts = await Promise.all(Array.from({ length: 20 }, () => hitRateLimit("k", 60)));
    expect([...counts].sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it("starts over once the window has passed", async () => {
    await hitRateLimit("k", 60);
    await hitRateLimit("k", 60);
    await db
      .update(authRateLimits)
      .set({ windowStart: sql`now() - interval '61 seconds'` })
      .where(eq(authRateLimits.key, "k"));

    expect(await hitRateLimit("k", 60)).toBe(1);
  });

  it("clears a key", async () => {
    await hitRateLimit("k", 60);
    await clearRateLimit("k");
    expect(await hitRateLimit("k", 60)).toBe(1);
  });
});

describe("sign-in through the Server Action", () => {
  it("refuses an address after its limit, even with the right password", async () => {
    for (let i = 0; i < AUTH_LIMITS.signInPerAddress.max; i++) {
      expect(await signIn("wrong-password")).toEqual({ error: expect.not.stringMatching(/Too many/) });
    }

    expect(await signIn("wrong-password")).toEqual(LIMITED);
    expect(await signIn(TEST_PASSWORD)).toEqual(LIMITED);
  });

  it("holds the address limit when the guesser changes IP", async () => {
    for (let i = 0; i < AUTH_LIMITS.signInPerAddress.max; i++) {
      client.ip = `203.0.113.${i + 1}`;
      await signIn("wrong-password");
    }

    client.ip = "203.0.113.200";
    expect(await signIn(TEST_PASSWORD)).toEqual(LIMITED);
  });

  it("answers the same for an address with no account", async () => {
    // Counting is per address whether or not it has an account, so the limit
    // can't be used to find out which ones do.
    for (let i = 0; i < AUTH_LIMITS.signInPerAddress.max; i++) await signIn("x", "nobody@asaph.test");
    expect(await signIn("x", "nobody@asaph.test")).toEqual(LIMITED);
  });

  it("clears an address's count when sign-in succeeds", async () => {
    for (let i = 0; i < AUTH_LIMITS.signInPerAddress.max - 1; i++) await signIn("wrong-password");
    expect(await signIn(TEST_PASSWORD)).toEqual({ signedIn: true });

    // A fresh allowance: these would have tipped it over without the reset.
    for (let i = 0; i < AUTH_LIMITS.signInPerAddress.max - 1; i++) await signIn("wrong-password");
    expect(await signIn(TEST_PASSWORD)).toEqual({ signedIn: true });
  });

  it("refuses one IP spraying many addresses", async () => {
    // Driven through the limiter directly: 50 real sign-ins would spend most of
    // this test hashing passwords, and the action path is covered above.
    for (let i = 0; i < AUTH_LIMITS.signInPerIp.max; i++) {
      await limitAuthAttempt({ path: "/sign-in/email", ip: client.ip, body: { email: `spray-${i}@asaph.test` } });
    }

    expect(await signIn(TEST_PASSWORD)).toEqual(LIMITED);
    client.ip = "198.51.100.8";
    expect(await signIn(TEST_PASSWORD)).toEqual({ signedIn: true });
  });
});

describe("sign-in over HTTP", () => {
  it("shares the counters the Server Action uses", async () => {
    for (let i = 0; i < AUTH_LIMITS.signInPerAddress.max; i++) await signIn("wrong-password");

    const response = await auth.handler(
      new Request("https://asaph.example.com/api/auth/sign-in/email", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://asaph.example.com",
          "x-forwarded-for": "192.0.2.50",
        },
        body: JSON.stringify({ email: owner.email, password: TEST_PASSWORD }),
      }),
    );

    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ code: TOO_MANY_ATTEMPTS });
  });
});

describe("the other limited endpoints", () => {
  it("limits password reset requests per client", async () => {
    for (let i = 0; i < AUTH_LIMITS.resetRequestPerIp.max; i++) {
      await limitAuthAttempt({ path: "/request-password-reset", ip: client.ip, body: {} });
    }

    expect(await actions.requestPasswordResetAction(undefined, form({ email: owner.email }))).toEqual(LIMITED);
  });

  it("limits sign-ups per client", async () => {
    for (let i = 0; i < AUTH_LIMITS.signUpPerIp.max; i++) {
      await limitAuthAttempt({ path: "/sign-up/email", ip: client.ip, body: {} });
    }

    const result = await actions.signUpAction(
      undefined,
      form({ email: "new@asaph.test", password: TEST_PASSWORD, confirmPassword: TEST_PASSWORD }),
    );
    expect(result).toEqual(LIMITED);
  });

  it("leaves unlisted endpoints alone", async () => {
    const before = await db.select().from(authRateLimits);
    for (let i = 0; i < 100; i++) await limitAuthAttempt({ path: "/get-session", ip: client.ip, body: {} });
    expect(await db.select().from(authRateLimits)).toEqual(before);
  });
});

describe("clientIp", () => {
  const options = auth.options;

  it("reads a single forwarded address", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "198.51.100.7" }), options)).toBe("198.51.100.7");
  });

  it("won't trust a forwarded chain it wasn't told how to read", () => {
    // A client that prepends its own X-Forwarded-For produces a chain. Without
    // TRUSTED_PROXIES there's no telling which entry is real. In production
    // that's the shared "unresolved" bucket; under test Better Auth falls back
    // to localhost instead. Either way, neither entry is believed.
    const ip = clientIp(new Headers({ "x-forwarded-for": "1.2.3.4, 198.51.100.7" }), options);
    expect(["unresolved", "127.0.0.1"]).toContain(ip);
  });

  it("reads a chain back to the first hop that isn't a trusted proxy", () => {
    const behindProxy = { ...options, advanced: { ipAddress: { trustedProxies: ["198.51.100.0/24"] } } };
    expect(clientIp(new Headers({ "x-forwarded-for": "1.2.3.4, 198.51.100.7" }), behindProxy)).toBe("1.2.3.4");
  });

  it("shares one bucket for calls with no request headers at all", () => {
    expect(clientIp(undefined, options)).toBe("unresolved");
  });
});

describe("ipAddressOptions", () => {
  it("reads TRUSTED_PROXIES and CLIENT_IP_HEADER", () => {
    vi.stubEnv("TRUSTED_PROXIES", " 10.0.0.0/8, 172.16.0.1 ,");
    vi.stubEnv("CLIENT_IP_HEADER", "CF-Connecting-IP");
    expect(ipAddressOptions()).toEqual({
      trustedProxies: ["10.0.0.0/8", "172.16.0.1"],
      ipAddressHeaders: ["cf-connecting-ip"],
    });
    vi.unstubAllEnvs();
  });

  it("leaves Better Auth's defaults alone when neither is set", () => {
    vi.stubEnv("TRUSTED_PROXIES", "");
    vi.stubEnv("CLIENT_IP_HEADER", "");
    expect(ipAddressOptions()).toEqual({});
    vi.unstubAllEnvs();
  });
});
