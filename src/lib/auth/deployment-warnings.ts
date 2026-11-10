/**
 * Configuration that leaves an instance weaker than it looks, worded for the
 * operator reading the log. `BETTER_AUTH_URL` carries more than its name says:
 * behind a TLS-terminating proxy the app sees plain http on every request, so
 * that variable is the only way it knows browsers are on https. It decides
 * Secure cookies, HSTS and `upgrade-insecure-requests`, and it's the origin
 * for password reset and confirmation links.
 *
 * Warnings rather than a refusal to start, so an existing install that relied
 * on the variable being optional keeps running; the log says what it costs.
 */

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function deploymentWarnings(env: NodeJS.ProcessEnv = process.env): string[] {
  if (env.NODE_ENV !== "production") return [];

  const raw = env.BETTER_AUTH_URL?.trim();
  if (!raw) {
    return [
      "BETTER_AUTH_URL is not set. Set it to your public origin (https://…). Without it, session " +
        "cookies are marked Secure only by guesswork, HSTS is never sent, and password reset and " +
        "email confirmation are switched off.",
    ];
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return [`BETTER_AUTH_URL (${raw}) isn't a URL. Set it to your public origin, e.g. https://asaph.example.com.`];
  }

  if (url.protocol === "http:" && !LOOPBACK.has(url.hostname)) {
    return [
      `BETTER_AUTH_URL is plain http (${url.origin}) on a host other than this machine. If browsers ` +
        "reach the app over https through a proxy, set it to the https origin: until then session " +
        "cookies aren't marked Secure and HSTS is off.",
    ];
  }
  return [];
}

let logged = false;

/** Logs the warnings once per server process, and not while `next build` evaluates modules. */
export function logDeploymentWarnings(): void {
  if (logged || process.env.NEXT_PHASE === "phase-production-build") return;
  logged = true;
  for (const warning of deploymentWarnings()) console.warn(`[config] ${warning}`);
}
