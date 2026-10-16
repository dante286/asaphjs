import { shouldSendReset } from "@/db/queries/password-reset";
import { emailConfigured, passwordResetEmail, sendEmail } from "@/lib/email";

/** Better Auth's default, set explicitly so the email can state it. */
export const RESET_TOKEN_TTL_SECONDS = 60 * 60;

/**
 * Where reset links point: the origin of `BETTER_AUTH_URL`, or `null` when it's
 * unset or isn't an http(s) URL.
 *
 * Deliberately *not* `requestOrigin()`, which share and invite links use. That
 * reads `Host` and `X-Forwarded-Host`, and whoever sends the request chooses
 * those. Ask for a reset of someone else's address with a forged host and they
 * receive a real token on a link to your domain — one click and you hold their
 * account. An invite token only works for the account it names, so the same
 * forgery buys nothing there; a reset token *is* the account. The origin has to
 * come from the operator, and `BETTER_AUTH_URL` is the one they already set.
 *
 * Read per call, like `emailConfigured()`, so tests can stub it.
 */
export function resetLinkOrigin(): string | null {
  const raw = process.env.BETTER_AUTH_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}

/**
 * Reset needs somewhere to send mail and a trustworthy origin for the link.
 * Without both the feature isn't offered at all — no "Forgot password?" link,
 * and Better Auth's endpoint answers RESET_PASSWORD_DISABLED — rather than
 * being something you discover doesn't work by filling in a form. Recovery is
 * then the operator, as it always was.
 */
export function passwordResetAvailable(): boolean {
  return emailConfigured() && resetLinkOrigin() !== null;
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
  const origin = resetLinkOrigin();
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
