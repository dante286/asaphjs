/**
 * Where links that carry a credential point: the origin of `BETTER_AUTH_URL`,
 * or `null` when it's unset or isn't an http(s) URL. Password reset links and
 * registration invite links use it.
 *
 * Deliberately *not* `requestOrigin()`, which share and collection invite links
 * use. That reads `Host` and `X-Forwarded-Host`, and whoever sends the request
 * chooses those. Ask for a reset of someone else's address with a forged host,
 * or invite them to register with one, and they receive a real token on a link
 * to your domain — one click and you hold their account, or register as them.
 * A collection invite token only works for an account that already exists, so
 * the same forgery buys nothing there; these tokens *are* the account. The
 * origin has to come from the operator, and `BETTER_AUTH_URL` is the one they
 * already set.
 *
 * Read per call, like `emailConfigured()`, so tests can stub it.
 */
export function trustedLinkOrigin(): string | null {
  const raw = process.env.BETTER_AUTH_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}
