import { createTransport } from "nodemailer";
import { smtpConfig, transportOptions } from "./config";

/**
 * Every message Asaph sends has both parts. Templates are plain functions that
 * return `{ subject, text, html }`, and the text part is a real one rather than
 * stripped HTML — it's what the console fallback prints, and what a text-only
 * client shows.
 */
export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

/**
 * What became of the message: delivered to the SMTP server, or printed to the
 * console because no server is configured. A caller that wants to tell the user
 * which (an invite that has to be shared by hand, say) reads this rather than
 * calling `emailConfigured()` a second time.
 */
export type SendOutcome = "sent" | "not_configured";

/**
 * The one way Asaph sends mail. Callers never touch nodemailer, so a test can
 * swap the transport at this seam and an HTTP-API provider would change this
 * file and nothing else.
 *
 * Awaited, and it throws. The transport doesn't decide what a failed send
 * means: a failed invite should keep the invite and say so, a failed password
 * reset should look like any other reset request. Each caller makes that call.
 *
 * A transport per message rather than a pooled one held for the process: mail
 * here is a handful of invites and resets, not a stream, and a fresh transport
 * means a changed `SMTP_*` variable takes effect without a restart path to
 * think about.
 */
export async function sendEmail(message: EmailMessage): Promise<SendOutcome> {
  const config = smtpConfig();

  if (!config) {
    // Today's behaviour, kept on purpose: an instance with no mail set up still
    // shows the operator what would have gone out — links included, since a
    // link in a log is the only way it reaches anyone.
    console.log(
      [
        "[email not configured] SMTP_HOST and EMAIL_FROM are unset, so this was logged instead of sent.",
        `To: ${message.to}`,
        `Subject: ${message.subject}`,
        "",
        message.text,
      ].join("\n"),
    );
    return "not_configured";
  }

  const transport = createTransport(transportOptions(config));
  await transport.sendMail({
    from: config.from,
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });
  return "sent";
}
