import { shouldSendReset } from "@/db/queries/password-reset";
import { emailConfigured, passwordResetEmail, sendEmail } from "@/lib/email";
import { trustedLinkOrigin } from "./link-origin";

/** Better Auth's default, set explicitly so the email can state it. */
export const RESET_TOKEN_TTL_SECONDS = 60 * 60;

/**
 * Reset needs somewhere to send mail and a trustworthy origin for the link
 * (`trustedLinkOrigin`, for why it isn't the request's own host).
 * Without both the feature isn't offered at all — no "Forgot password?" link,
 * and Better Auth's endpoint answers RESET_PASSWORD_DISABLED — rather than
 * being something you discover doesn't work by filling in a form. Recovery is
 * then the operator, as it always was.
 */
export function passwordResetAvailable(): boolean {
  return emailConfigured() && trustedLinkOrigin() !== null;
}

/**
 * Better Auth's `sendResetPassword`. It's handed a `url` too, which is ignored:
 * that one points at Better Auth's own `/api/auth/reset-password/:token`
 * redirect hop, built from its `baseURL`, and the page that takes the new
 * password is ours.
 *
 * Nothing thrown here reaches the caller (Better Auth awaits this and logs a
 * rejection), and nothing should: a reset for an address that has an account
 * must look exactly like one for an address that doesn't, so a failed send is
 * logged for the operator and the person sees the same "check your email".
 */
export async function sendResetPasswordEmail({ user, token }: { user: { id: string; email: string }; token: string }) {
  const origin = trustedLinkOrigin();
  // Not wired up without one, so only reachable if the variable vanished since.
  if (!origin) return;

  if (!(await shouldSendReset(user.id, token))) {
    console.log(`[auth] password reset for ${user.email} not sent: one already went out in the last minute.`);
    return;
  }

  try {
    await sendEmail(
      passwordResetEmail({
        to: user.email,
        url: `${origin}/auth/reset?token=${encodeURIComponent(token)}`,
        expiresInMinutes: RESET_TOKEN_TTL_SECONDS / 60,
      }),
    );
  } catch (err) {
    console.error(`[email] password reset to ${user.email} wasn't sent:`, err);
  }
}
