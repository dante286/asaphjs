import { escapeHtml } from "./escape";
import type { EmailMessage } from "./send";

/**
 * The invitation to register, sent from the Invite someone card. It's the only
 * way the token travels — there's no copy-link fallback — and that's what lets
 * holding the token stand in for owning this inbox.
 *
 * The inviter's name is typed by a user, so the HTML part escapes it, as the
 * collection invite does.
 */
export function registrationInviteEmail(params: {
  to: string;
  inviterName: string;
  /** Absolute, built from `trustedLinkOrigin()` by the caller and never from the request. */
  url: string;
  expiresInDays: number;
}): EmailMessage {
  const { to, inviterName, url, expiresInDays } = params;

  return {
    to,
    // Header values can't carry a line break.
    subject: `${inviterName} invited you to Asaph`.replace(/\s+/g, " "),
    text: [
      `${inviterName} invited you to create an account on their Asaph instance.`,
      "",
      "Create your account:",
      url,
      "",
      `The link works once, for ${to}, and expires in ${expiresInDays} days.`,
      "",
      "If you weren't expecting this, you can ignore it.",
    ].join("\n"),
    html: [
      `<p>${escapeHtml(inviterName)} invited you to create an account on their Asaph instance.</p>`,
      `<p><a href="${escapeHtml(url)}">Create your account</a></p>`,
      `<p>The link works once, for ${escapeHtml(to)}, and expires in ${expiresInDays} days.</p>`,
      `<p style="color:#777">If the link doesn't work, paste this into your browser:<br>${escapeHtml(url)}</p>`,
      "<p style=\"color:#777\">If you weren't expecting this, you can ignore it.</p>",
    ].join("\n"),
  };
}
