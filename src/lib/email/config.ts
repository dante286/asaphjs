/**
 * SMTP settings, read from discrete variables rather than one `SMTP_URL`.
 *
 * A URL was the first idea and was rejected: Azure Communication Services
 * authenticates with an Entra client secret as the password, and those
 * routinely contain characters like `~` that need percent-encoding inside a
 * URL. Forgetting to encode one isn't a config error — it's an authentication
 * failure that looks exactly like a wrong password. Separate variables leave
 * nothing to encode.
 *
 * Read on every call rather than captured at module load, so tests can stub the
 * environment per case and so `emailConfigured()` answers for the process as it
 * is now, not as it was when something first imported this file.
 */

export type SmtpConfig = {
  host: string;
  port: number;
  /** Absent for an unauthenticated relay — Mailpit, or a local MTA. */
  auth?: { user: string; pass: string };
  from: string;
};

const DEFAULT_PORT = 587;

function read(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

/**
 * True only when there's somewhere to send and someone to send as. Everything
 * else is optional (the port has a default, a relay may need no login), so
 * these two are the whole switch between real mail and the console fallback.
 * Neither is required to run Asaph: most instances will never set up mail.
 */
export function emailConfigured(): boolean {
  return read("SMTP_HOST") !== undefined && read("EMAIL_FROM") !== undefined;
}

/**
 * The settings to send with, or `null` when email isn't configured. Throws on
 * values that are present but can't work, so the operator reads a message
 * naming the variable rather than a socket error that names nothing.
 */
export function smtpConfig(): SmtpConfig | null {
  const host = read("SMTP_HOST");
  const from = read("EMAIL_FROM");
  if (!host || !from) return null;

  const rawPort = read("SMTP_PORT");
  const port = rawPort === undefined ? DEFAULT_PORT : Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`SMTP_PORT must be a port number, got ${JSON.stringify(rawPort)}.`);
  }

  const user = read("SMTP_USER");
  // Trimmed like the rest. Entra client secrets are drawn from letters, digits
  // and `~._-`, so surrounding whitespace is never part of one — it's a stray
  // space after the `=` in an env file, and sending it would fail exactly like
  // a wrong password.
  const pass = read("SMTP_PASSWORD");
  if (pass !== undefined && user === undefined) {
    // nodemailer would quietly skip AUTH without a user, and the server's
    // "authentication required" would then read as a wrong password.
    throw new Error("SMTP_PASSWORD is set but SMTP_USER is not.");
  }

  return {
    host,
    port,
    auth: user === undefined ? undefined : { user, pass: pass ?? "" },
    from,
  };
}

/**
 * Loopback, by the same rule `requestOrigin` uses for its scheme guess. Mail
 * to a loopback address never leaves the machine, so there's no network for
 * anyone to strip STARTTLS on.
 */
export function isLoopbackHost(host: string): boolean {
  return /^(localhost|127\.0\.0\.1|::1|\[::1\])$/i.test(host);
}

/**
 * How the connection is secured, decided by the host and port alone.
 *
 * - **465** is implicit TLS: the socket is TLS from the first byte.
 * - **Any other port** must upgrade with STARTTLS, and a server that doesn't
 *   offer it is an error rather than a plaintext send. The payloads are invite
 *   and password-reset tokens, and nodemailer's default — use STARTTLS if
 *   advertised — is exactly what a downgrade attack exploits: strip the
 *   advertisement and the client carries on in the clear.
 * - **A loopback host** sends plaintext and ignores STARTTLS. That's what makes
 *   Mailpit work for local dev (it only offers STARTTLS when given a cert, which
 *   the client would then have to be told to trust), and it's also right for a
 *   production relay on localhost, whose certificate is usually self-signed.
 *   Implicit TLS on 465 still applies — the port says the server speaks TLS.
 */
export function tlsMode(host: string, port: number): "implicit" | "starttls" | "none" {
  if (port === 465) return "implicit";
  if (isLoopbackHost(host)) return "none";
  return "starttls";
}

/**
 * Tighter than nodemailer's defaults (two minutes to connect, ten of socket
 * inactivity). Sending happens inline with the request that triggered it, so an
 * SMTP server that accepts the TCP connection and then goes quiet would
 * otherwise hold someone's "Send invite" click for minutes before failing.
 */
export const SMTP_TIMEOUTS = {
  connectionTimeout: 10_000,
  greetingTimeout: 10_000,
  socketTimeout: 20_000,
} as const;

/** The options handed to `nodemailer.createTransport`. */
export function transportOptions(config: SmtpConfig) {
  const mode = tlsMode(config.host, config.port);
  return {
    host: config.host,
    port: config.port,
    secure: mode === "implicit",
    requireTLS: mode === "starttls",
    ignoreTLS: mode === "none",
    auth: config.auth,
    ...SMTP_TIMEOUTS,
  };
}
