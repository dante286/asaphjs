import { escapeHtml } from "./escape";
import type { EmailMessage } from "./send";

/**
 * The address-verification link, sent from Better Auth's `sendVerificationEmail`.
 * The URL carries `&`, so it's escaped into the HTML part's attribute and text.
 * Nothing else in it is typed by anyone but the recipient.
 */
export function verificationEmail(params: {
  to: string;
  /** Absolute, built from `BETTER_AUTH_URL` by the caller. */
  url: string;
  expiresInMinutes: number;
}): EmailMessage {
  const { to, url, expiresInMinutes } = params;
  const href = escapeHtml(url);

  return {
    to,
    subject: "Confirm your email address for Asaph",
    text: [
      `Confirm that ${to} is your address on Asaph:`,
      url,
      "",
      `The link expires in ${expiresInMinutes} minutes. Until you confirm, you can use your collections but can't send invites.`,
      "",
      "If you didn't create an Asaph account, ignore this: nothing happens until the link is opened.",
    ].join("\n"),
    html: [
      `<p>Confirm that ${escapeHtml(to)} is your address on Asaph.</p>`,
      `<p><a href="${href}">Confirm my email address</a></p>`,
      `<p>The link expires in ${expiresInMinutes} minutes. Until you confirm, you can use your collections but can't send invites.</p>`,
      `<p style="color:#777">If the link doesn't work, paste this into your browser:<br>${href}</p>`,
      `<p style="color:#777">If you didn't create an Asaph account, ignore this: nothing happens until the link is opened.</p>`,
    ].join("\n"),
  };
}
