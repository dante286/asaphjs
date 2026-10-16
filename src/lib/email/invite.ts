import type { EmailMessage } from "./send";

/**
 * The invite a collection owner sends from the Sharing card.
 *
 * The inviter's name and the collection's name are both typed by a user, so the
 * HTML part escapes them — an owner who calls a collection `<img src=…>` gets
 * that text in someone's inbox, not markup. The text part needs nothing: it's
 * sent as `text/plain` and no client renders it.
 */
export function inviteEmail(params: {
  to: string;
  inviterName: string;
  collectionName: string;
  role: "viewer" | "editor";
  /** Absolute, built from `requestOrigin()` by the caller. */
  url: string;
  expiresInDays: number;
}): EmailMessage {
  const { to, inviterName, collectionName, role, url, expiresInDays } = params;
  const access = role === "editor" ? "view and edit" : "view";

  return {
    to,
    // Header values can't carry a line break; collapse whitespace so a name with
    // one still makes a single-line subject rather than something nodemailer
    // has to guess about.
    subject: `${inviterName} shared ${collectionName} with you`.replace(/\s+/g, " "),
    text: [
      `${inviterName} invited you to ${access} their collection "${collectionName}" on Asaph.`,
      "",
      "Accept the invite:",
      url,
      "",
      `Open it signed in as ${to}: the invite only works for that address.`,
      `The link expires in ${expiresInDays} days.`,
      "",
      "If you weren't expecting this, you can ignore it.",
    ].join("\n"),
    html: [
      `<p>${escapeHtml(inviterName)} invited you to ${access} their collection <strong>${escapeHtml(collectionName)}</strong> on Asaph.</p>`,
      `<p><a href="${escapeHtml(url)}">Accept the invite</a></p>`,
      `<p>Open it signed in as ${escapeHtml(to)}: the invite only works for that address. The link expires in ${expiresInDays} days.</p>`,
      `<p style="color:#777">If the link doesn't work, paste this into your browser:<br>${escapeHtml(url)}</p>`,
      "<p style=\"color:#777\">If you weren't expecting this, you can ignore it.</p>",
    ].join("\n"),
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
