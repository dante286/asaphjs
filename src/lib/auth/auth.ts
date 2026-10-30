import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@/db/client";
import { deleteUploadsForOwner } from "@/db/queries/collections";
import { findInviteByToken, markInviteUsed } from "@/db/queries/registration-invites";
import { passwordResetAvailable, RESET_TOKEN_TTL_SECONDS, sendResetPasswordEmail } from "./password-reset";
import { signupsAllowed } from "./signups";

/**
 * Read once, at module evaluation, like the rest of this config: changing
 * ALLOW_SIGNUPS needs a restart. `src/lib/auth/auth.db.test.ts` pins that.
 */
const signupsOpen = signupsAllowed();

/** Today's answer to a closed sign-up, word for word, so the form and API clients see no change. */
function signUpClosed(): APIError {
  return new APIError("BAD_REQUEST", {
    message: "Email and password sign up is not enabled",
    code: "EMAIL_PASSWORD_SIGN_UP_DISABLED",
  });
}

/** The `inviteToken` a sign-up carried, if it carried a string one. */
function inviteTokenFrom(ctx: { body?: unknown } | null): string | undefined {
  const token = (ctx?.body as { inviteToken?: unknown } | undefined)?.inviteToken;
  return typeof token === "string" && token ? token : undefined;
}

/**
 * Whether a closed instance lets this sign-up through: `token` names a pending
 * invite, and it's for exactly this address. The one check, run by both the
 * early refusal in `hooks.before` and the gate in `databaseHooks`.
 */
async function inviteAdmits(token: string | undefined, email: unknown): Promise<boolean> {
  if (!token || typeof email !== "string") return false;
  const invite = await findInviteByToken(token);
  return invite?.email === email.toLowerCase();
}

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
  }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    minPasswordLength: 8,
    // Always on: closing registration is `databaseHooks.user.create.before`
    // below, which can let an invited address through where this flag couldn't.
    disableSignUp: false,
    // Wired in only when it can work (mail configured, BETTER_AUTH_URL set —
    // see password-reset.ts for why the link can't come from the request).
    // Absent, `/request-password-reset` answers RESET_PASSWORD_DISABLED, and
    // /auth doesn't offer the link. Read once, like `signupsOpen`.
    sendResetPassword: passwordResetAvailable() ? sendResetPasswordEmail : undefined,
    resetPasswordTokenExpiresIn: RESET_TOKEN_TTL_SECONDS,
    // A reset is often the answer to a compromised account, so it ends every
    // session, not just the ones on devices the person still has.
    revokeSessionsOnPasswordReset: true,
  },
  user: {
    additionalFields: {
      timeZone: {
        type: "string",
        required: false,
        defaultValue: "UTC",
        input: true,
      },
      currency: {
        type: "string",
        required: false,
        defaultValue: "USD",
        input: true,
      },
    },
    deleteUser: {
      enabled: true,
      // `beforeDelete` runs while the user's collections and items are still
      // there, which is the only moment their cover URLs can be read at all:
      // `collections.owner_id` cascades from `user`, items cascade from
      // collections, and Postgres does that in one statement the app never sees
      // row by row. `afterDelete` would fire with the rows already gone and no
      // record of which files they named, leaving the uploads orphaned in the
      // volume permanently — the exact hazard `deleteCollection` exists to avoid.
      //
      // Nothing here catches: a covers list we couldn't read is a sweep we can't
      // perform, and refusing the deletion (a 500 the person can retry) beats
      // silently stranding their photos on disk forever. The unlinks themselves
      // are best-effort inside `deleteUploads`, so a file already missing — or a
      // read-only mount — doesn't block anyone from leaving.
      beforeDelete: async (deleted) => {
        await deleteUploadsForOwner(deleted.id);
      },
    },
  },
  databaseHooks: {
    user: {
      create: {
        /**
         * The registration gate. Every way of creating a user passes through
         * here — the Server Actions, a direct POST to `/api/auth/sign-up/email`,
         * and any sign-in method added later — which is why it lives here rather
         * than in an action. With signups closed, only a pending invite for this
         * exact address lets one through; anything else, including a call with
         * no endpoint context at all, gets today's EMAIL_PASSWORD_SIGN_UP_DISABLED.
         *
         * It throws rather than returning `false`: `false` keeps the door shut
         * too, but surfaces as FAILED_TO_CREATE_USER. The token reaches here
         * through `ctx.body` and is never written to `user`, because
         * `parseUserInput` keeps only declared fields.
         */
        before: async (user, ctx) => {
          if (signupsOpen) return;

          if (!(await inviteAdmits(inviteTokenFrom(ctx), user.email))) throw signUpClosed();
        },
        /**
         * Better Auth queues this until the sign-up transaction commits, so a
         * sign-up that fails never uses up the invite. Single use doesn't rest on
         * this write: the invite is bound to one address and `user.email` is
         * unique, so a second account from one token is impossible either way.
         * It's what refuses a replay early, in `hooks.before`, and what takes the
         * invite off the inviter's list.
         */
        after: async (user, ctx) => {
          const token = inviteTokenFrom(ctx);
          if (!signupsOpen && token) await markInviteUsed(token, user.email);
        },
      },
    },
  },
  hooks: {
    /**
     * The same check, earlier, for email and password sign-up. The database
     * hook alone runs too late: `signUpEmail` looks the address up before it
     * creates anyone, and answers USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL for one
     * that has an account. With signups closed that turned sign-up into a way to
     * find out who has an account here, which `disableSignUp` never was, since
     * it refused before the lookup. Refusing here, before the route runs, puts
     * that back: everyone without a pending invite gets the same answer. A
     * replayed token now meets this too, rather than the duplicate check.
     *
     * Not instead of the database hook, which still covers every other way of
     * creating a user.
     */
    before: createAuthMiddleware(async (ctx) => {
      if (signupsOpen || ctx.path !== "/sign-up/email") return;
      const email = (ctx.body as { email?: unknown } | undefined)?.email;
      if (!(await inviteAdmits(inviteTokenFrom(ctx), email))) throw signUpClosed();
    }),
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24, // rolling refresh once a day
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5,
    },
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      console.log(`[dev email stub] verification link for ${user.email}: ${url}`);
    },
  },
  // Must be the last plugin — lets Server Actions set session cookies directly.
  plugins: [nextCookies()],
});

export type Session = typeof auth.$Infer.Session;
