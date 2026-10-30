import { emailConfigured } from "@/lib/email";
import { trustedLinkOrigin } from "./link-origin";
import { signupsAllowed } from "./signups";

/**
 * Whether anyone can invite someone to register: only with signups closed (open,
 * there's nothing to authorize, and the card would be an email-sending button
 * anyone could reach by registering), with mail configured, and with a
 * `BETTER_AUTH_URL` to build the link from. Those last two are what make holding
 * the token a fair stand-in for owning the inbox: every token that exists was
 * actually emailed, on a link to the real instance.
 *
 * Gates sending only. Redeeming doesn't re-check any of this: an invite sent
 * before mail was switched off is still proof of the inbox.
 */
export function registrationInvitesAvailable(): boolean {
  return !signupsAllowed() && emailConfigured() && trustedLinkOrigin() !== null;
}
