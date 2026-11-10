import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { user } from "@/db/schema";
import { hitRateLimit } from "@/db/queries/auth-rate-limits";
import { emailConfigured, sendEmail, verificationEmail } from "@/lib/email";
import { trustedLinkOrigin } from "./link-origin";

/** Better Auth's default, set explicitly so the email can state it. */
export const VERIFICATION_TOKEN_TTL_SECONDS = 60 * 60;

/** Where the link lands once Better Auth has checked the token. Relative, so it passes its origin check. */
export const VERIFIED_CALLBACK_PATH = "/account?verified=1";

/** One verification email per account per this many seconds, however it was asked for. */
export const VERIFICATION_COOLDOWN_SECONDS = 60;

/**
 * Verification needs what password reset needs: somewhere to send mail, and a
 * trustworthy origin for the link (`trustedLinkOrigin`, for why not the
 * request's host). Without both, nothing is sent and nothing is gated on it:
 * an instance that can't send mail can't ask anyone to prove an address.
 */
export function emailVerificationAvailable(): boolean {
  return emailConfigured() && trustedLinkOrigin() !== null;
}

/**
 * Read from the user row rather than the session's copy of the user, so it
 * reflects a link clicked a moment ago whatever the session has cached.
 */
export async function isEmailVerified(userId: string): Promise<boolean> {
  const row = await db.query.user.findFirst({ where: eq(user.id, userId), columns: { emailVerified: true } });
  return row?.emailVerified ?? false;
}

/**
 * Whether this account may send invites. Verification is only asked for where
 * it can be given, so an instance without mail gates nothing.
 */
export async function mayInvite(userId: string): Promise<boolean> {
  return !emailVerificationAvailable() || (await isEmailVerified(userId));
}

/**
 * Better Auth's `sendVerificationEmail`. Its own `url` is ignored, as in
 * `sendResetPasswordEmail`: that one is built from `baseURL`, and the link has
 * to come from `BETTER_AUTH_URL` alone.
 *
 * Skips accounts that are already verified. Better Auth sends on sign-up
 * whatever the new row says, and a sign-up through a registration invite is
 * verified from the start.
 *
 * Nothing thrown here reaches the caller, and a held-back or failed send looks
 * the same as a sent one, so this can't tell anyone anything about an account.
 * The operator gets the reason in the log.
 *
 * This replaced a development stub that printed the tokenized link to the
 * server log.
 */
export async function sendVerificationEmail({
  user: account,
  token,
}: {
  user: { id: string; email: string; emailVerified: boolean };
  token: string;
}): Promise<void> {
  if (account.emailVerified) return;
  const origin = trustedLinkOrigin();
  // Not wired up without one, so only reachable if the variable vanished since.
  if (!origin) return;

  if ((await hitRateLimit(`verify-email:user:${account.id}`, VERIFICATION_COOLDOWN_SECONDS)) > 1) {
    console.log(`[auth] verification email for ${account.email} not sent: one already went out in the last minute.`);
    return;
  }

  const url =
    `${origin}/api/auth/verify-email?token=${encodeURIComponent(token)}` +
    `&callbackURL=${encodeURIComponent(VERIFIED_CALLBACK_PATH)}`;

  try {
    await sendEmail(
      verificationEmail({ to: account.email, url, expiresInMinutes: VERIFICATION_TOKEN_TTL_SECONDS / 60 }),
    );
  } catch (err) {
    console.error(`[email] verification email to ${account.email} wasn't sent:`, err);
  }
}
