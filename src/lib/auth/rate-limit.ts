import { APIError, getIP } from "better-auth/api";
import type { BetterAuthOptions } from "better-auth";
import { clearRateLimit, hitRateLimit } from "@/db/queries/auth-rate-limits";

/**
 * Attempt limits for the endpoints that check a password or create an account.
 *
 * Better Auth has a rate limiter of its own, but it runs in the HTTP router's
 * `onRequest`, and Asaph's forms call `auth.api.*` from Server Actions, which
 * never pass through it. These limits run in `hooks.before` instead (see
 * `src/lib/auth/auth.ts`), which every call takes, HTTP or direct, so the forms
 * and `/api/auth/*` share one set of counters.
 *
 * Every attempt counts, not only failures, and is counted *before* the endpoint
 * runs. Counting after would let a burst of concurrent guesses all read the
 * same count and all get through. A successful sign-in then clears its
 * address's counter, so someone who mistyped a few times isn't held to it.
 *
 * Sign-in has two keys. Per address, so rotating IPs doesn't help against one
 * account. Per IP, so one client can't spray a common password across many
 * accounts. The per-address one is also what someone can use to lock a person
 * out for a window by guessing wrong on purpose; a short window keeps that
 * cheap to wait out, and is the usual price of the protection.
 */
export const AUTH_LIMITS = {
  signInPerAddress: { windowSeconds: 15 * 60, max: 10 },
  signInPerIp: { windowSeconds: 15 * 60, max: 50 },
  signUpPerIp: { windowSeconds: 60 * 60, max: 10 },
  resetRequestPerIp: { windowSeconds: 15 * 60, max: 10 },
  resetPerIp: { windowSeconds: 15 * 60, max: 10 },
  passwordCheckPerIp: { windowSeconds: 15 * 60, max: 10 },
} as const;

type Limit = { windowSeconds: number; max: number };

/** The code the actions match on to tell a limit from a wrong password. */
export const TOO_MANY_ATTEMPTS = "TOO_MANY_ATTEMPTS";

/**
 * Every client whose IP can't be trusted shares this one bucket. Better Auth's
 * resolver returns nothing for a forwarded chain it wasn't told how to read,
 * and sending a forged `X-Forwarded-For` is exactly how a client produces one.
 * Skipping the IP limit for those would make forging the header a way out of
 * it; sharing a bucket makes it a way into the strictest one instead.
 */
const UNRESOLVED_IP = "unresolved";

function addressKey(body: unknown): string | null {
  const email = (body as { email?: unknown } | undefined)?.email;
  return typeof email === "string" && email.trim() ? `sign-in:email:${email.trim().toLowerCase()}` : null;
}

function keysFor(path: string, ip: string, body: unknown): Array<{ key: string; limit: Limit }> {
  switch (path) {
    case "/sign-in/email": {
      const keys: Array<{ key: string; limit: Limit }> = [{ key: `sign-in:ip:${ip}`, limit: AUTH_LIMITS.signInPerIp }];
      const address = addressKey(body);
      if (address) keys.push({ key: address, limit: AUTH_LIMITS.signInPerAddress });
      return keys;
    }
    case "/sign-up/email":
      return [{ key: `sign-up:ip:${ip}`, limit: AUTH_LIMITS.signUpPerIp }];
    case "/request-password-reset":
      return [{ key: `reset-request:ip:${ip}`, limit: AUTH_LIMITS.resetRequestPerIp }];
    case "/reset-password":
      return [{ key: `reset:ip:${ip}`, limit: AUTH_LIMITS.resetPerIp }];
    // Both take the current password, so a stolen session could otherwise be
    // used to guess it.
    case "/change-password":
    case "/delete-user":
      return [{ key: `password-check:ip:${ip}`, limit: AUTH_LIMITS.passwordCheckPerIp }];
    default:
      return [];
  }
}

/**
 * Counts this attempt and refuses it if any of its limits is now exceeded. A
 * no-op for paths without limits. The refusal names no key, so it says nothing
 * about whether an address has an account or which limit was hit.
 */
export async function limitAuthAttempt(input: { path: string; ip: string; body: unknown }): Promise<void> {
  const keys = keysFor(input.path, input.ip, input.body);
  const counts = await Promise.all(keys.map(({ key, limit }) => hitRateLimit(key, limit.windowSeconds)));

  if (counts.some((count, i) => count > keys[i].limit.max)) {
    throw new APIError("TOO_MANY_REQUESTS", {
      message: "Too many attempts. Wait a few minutes and try again.",
      code: TOO_MANY_ATTEMPTS,
    });
  }
}

/** After a successful sign-in: that address starts over. The IP's count stands. */
export async function recordAuthSuccess(input: { path: string; body: unknown }): Promise<void> {
  if (input.path !== "/sign-in/email") return;
  const address = addressKey(input.body);
  if (address) await clearRateLimit(address);
}

let warnedUnresolved = false;

/**
 * The client IP as Better Auth resolves it, honoring the same `advanced.ipAddress`
 * settings, so these limits and its own agree on who a client is.
 */
export function clientIp(headers: Headers | undefined, options: BetterAuthOptions): string {
  const ip = headers ? getIP(headers, options) : null;
  if (ip) return ip;

  if (!warnedUnresolved && process.env.NODE_ENV === "production") {
    warnedUnresolved = true;
    console.warn(
      "[auth] Couldn't resolve a client IP for an auth request, so it shares one rate-limit bucket " +
        "with every other such request. Behind a proxy chain, set TRUSTED_PROXIES; behind a CDN that " +
        "sends the client IP in its own header, set CLIENT_IP_HEADER. See docs/self-hosting.md.",
    );
  }
  return UNRESOLVED_IP;
}

/**
 * Better Auth's `advanced.ipAddress`, from the environment. `TRUSTED_PROXIES` is
 * a comma-separated list of the proxies' IPs or CIDR ranges, which lets an
 * `X-Forwarded-For` chain be read back to the first hop that isn't one of them.
 * `CLIENT_IP_HEADER` names a single-value header a CDN sets instead, such as
 * `cf-connecting-ip`. Read once, with the rest of the auth config.
 */
export function ipAddressOptions(): NonNullable<BetterAuthOptions["advanced"]>["ipAddress"] {
  const trustedProxies = (process.env.TRUSTED_PROXIES ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const header = process.env.CLIENT_IP_HEADER?.trim().toLowerCase();

  return {
    ...(trustedProxies.length ? { trustedProxies } : {}),
    ...(header ? { ipAddressHeaders: [header] } : {}),
  };
}
