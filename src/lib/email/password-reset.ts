import type { EmailMessage } from "./send";

/**
 * The reset link, sent from Better Auth's `sendResetPassword`. Nothing in it is
 * typed by anyone but the recipient (an address and a generated token), so
 * there's nothing to escape — unlike the invite, which carries other people's
 * names.
 */
export function passwordResetEmail(params: {
  to: string;
  /** Absolute, built from `requestOrigin()` by the caller. */
  url: string;
  expiresInMinutes: number;
}): EmailMessage {
  const { to, url, expiresInMinutes } = params;

  return {
    to,
    subject: "Reset your Asaph password",
    text: [
      `Someone asked to reset the password for ${to} on Asaph.`,
      "",
      "Choose a new password:",
      url,
      "",
      `The link works once and expires in ${expiresInMinutes} minutes. Resetting signs out every device that's signed in.`,
      "",
      "If you didn't ask for this, ignore it: your password hasn't changed.",
    ].join("\n"),
    html: [
      `<p>Someone asked to reset the password for ${to} on Asaph.</p>`,
      `<p><a href="${url}">Choose a new password</a></p>`,
      `<p>The link works once and expires in ${expiresInMinutes} minutes. Resetting signs out every device that's signed in.</p>`,
      `<p style="color:#777">If the link doesn't work, paste this into your browser:<br>${url}</p>`,
      "<p style=\"color:#777\">If you didn't ask for this, ignore it: your password hasn't changed.</p>",
    ].join("\n"),
  };
}
