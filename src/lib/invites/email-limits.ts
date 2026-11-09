import { headers } from "next/headers";
import { auth } from "@/lib/auth/auth";
import { clientIp } from "@/lib/auth/rate-limit";
import { hitRateLimit } from "@/db/queries/auth-rate-limits";

/*
 * Not in `src/actions/members.ts`, which is a "use server" module and so may
 * only export async functions: an exported limits object there fails the whole
 * module at runtime, and Vitest doesn't enforce that rule.
 */

const DAY_SECONDS = 24 * 60 * 60;

/**
 * Invite emails are sent from this instance's mail account, to any address, with
 * a subject built from names the inviter chose. On an instance with open signups,
 * anyone can register and send them. Without limits, that's a spam and phishing
 * relay running on the operator's sending reputation.
 *
 * Three keys, all counted per attempt in the shared `auth_rate_limits` table:
 * - per inviter, so one account can't send in bulk;
 * - per recipient address, across every inviter, so a crowd of throwaway
 *   accounts can't flood one inbox;
 * - per client address, so those throwaway accounts can't come from one place.
 *
 * Only counted when mail is configured. Without it nothing is sent, and the
 * owner copies links by hand, which is no one's to abuse.
 */
export const INVITE_EMAIL_LIMITS = {
  perInviter: { windowSeconds: DAY_SECONDS, max: 20 },
  perRecipient: { windowSeconds: DAY_SECONDS, max: 5 },
  perClient: { windowSeconds: DAY_SECONDS, max: 50 },
} as const;

export async function inviteEmailAllowed(inviterId: string, address: string): Promise<boolean> {
  const ip = clientIp(await headers(), auth.options);
  const counts = await Promise.all([
    hitRateLimit(`invite:inviter:${inviterId}`, INVITE_EMAIL_LIMITS.perInviter.windowSeconds),
    hitRateLimit(`invite:recipient:${address}`, INVITE_EMAIL_LIMITS.perRecipient.windowSeconds),
    hitRateLimit(`invite:ip:${ip}`, INVITE_EMAIL_LIMITS.perClient.windowSeconds),
  ]);
  return (
    counts[0] <= INVITE_EMAIL_LIMITS.perInviter.max &&
    counts[1] <= INVITE_EMAIL_LIMITS.perRecipient.max &&
    counts[2] <= INVITE_EMAIL_LIMITS.perClient.max
  );
}

