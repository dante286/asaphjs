import { parseArgs } from "node:util";
import { config } from "dotenv";

// Same reason as scripts/seed/run.ts: load env here, not via a POSIX-only
// `-r dotenv/config` prefix on the npm script.
config({ path: ".env.local" });

/**
 * One-off smoke test for the mail transport: sends a single message through
 * `sendEmail`, the same seam invites and password resets will use, to an
 * address you own.
 *
 *   npm run email:test -- --address you@example.com
 *
 * Exits non-zero when nothing was delivered to the SMTP server — including when
 * mail isn't configured, since `sendEmail` would then only log the message and
 * a smoke test that "passes" by printing to the console proves nothing.
 *
 * Each run spends one message of the provider's quota (Resend's free plan: 100
 * a day).
 */
const { values } = parseArgs({ options: { address: { type: "string" } } });
const to = values.address?.trim();

if (!to) {
  console.error("Usage: npm run email:test -- --address you@example.com");
  process.exit(2);
}

async function main(to: string) {
  // Imported dynamically, like seed/run.ts, so the env above is loaded before
  // anything from src/ evaluates.
  const { sendEmail } = await import("@/lib/email");
  const { smtpConfig, tlsMode } = await import("@/lib/email/config");

  const smtp = smtpConfig();
  if (!smtp) {
    console.error("Mail isn't configured: set SMTP_HOST and EMAIL_FROM in .env.local.");
    process.exit(1);
  }

  const sentAt = new Date().toISOString();
  const subject = `Asaph email smoke test (${sentAt})`;
  console.log(`Subject: ${subject}`);
  console.log(`From:    ${smtp.from}`);
  console.log(`To:      ${to}`);
  console.log(`Server:  ${smtp.host}:${smtp.port} (TLS: ${tlsMode(smtp.host, smtp.port)})`);
  console.log(`Auth:    ${smtp.auth ? smtp.auth.user : "none"}`);

  const started = performance.now();
  const outcome = await sendEmail({
    to,
    subject,
    text: [
      "This is a test message from scripts/email-test.ts.",
      "",
      `Sent at ${sentAt} via ${smtp.host}:${smtp.port}.`,
      "If you can read this, Asaph's SMTP transport works.",
    ].join("\n"),
    html: [
      "<p>This is a test message from <code>scripts/email-test.ts</code>.</p>",
      `<p>Sent at ${sentAt} via <code>${smtp.host}:${smtp.port}</code>.</p>`,
      "<p>If you can read this, Asaph's SMTP transport works.</p>",
    ].join("\n"),
  });
  const ms = Math.round(performance.now() - started);

  if (outcome !== "sent") {
    console.error(`sendEmail returned "${outcome}" after ${ms} ms.`);
    process.exit(1);
  }
  console.log(`\nSent in ${ms} ms. Check ${to}'s inbox (and spam) for the subject above.`);
}

main(to).catch((err) => {
  console.error(err);
  process.exit(1);
});
