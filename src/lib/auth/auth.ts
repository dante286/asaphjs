import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@/db/client";
import { signupsAllowed } from "./signups";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
  }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    minPasswordLength: 8,
    // Closing registration here covers both entry points at once: `signUpAction`
    // calls `auth.api.signUpEmail` rather than reimplementing the insert, so the
    // Server Action and `/api/auth/sign-up/email` reject on the same check and
    // can't drift apart. Rejects 400 EMAIL_PASSWORD_SIGN_UP_DISABLED.
    disableSignUp: !signupsAllowed(),
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
