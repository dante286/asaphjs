import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@/db/client";
import { deleteUploadsForOwner } from "@/db/queries/collections";
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
