import { writeFile } from "node:fs/promises";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/db/client";
import { createCollection } from "@/db/queries/collections";
import { registrationInvites, templates, user as userTable } from "@/db/schema";
import { auth } from "@/lib/auth/auth";
import { UPLOAD_URL_PREFIX, thumbNameFor } from "@/lib/uploads/urls";
import type { FieldDef } from "@/lib/fields/field-def";

/**
 * The rows a spec needs before it can test anything, built through the same
 * code the app uses. Users go through `auth.api.signUpEmail` rather than an
 * insert into `user` and `account`: authentication here is email/password
 * against our own Postgres with no external identity provider, so there is
 * nothing to stub and a hand-rolled insert would only be a second, wrong
 * implementation of Better Auth's schema.
 */

/** Long enough for Better Auth's `minPasswordLength: 8`. Never varies — nothing tests the password. */
export const TEST_PASSWORD = "integration-tier-password";

/**
 * Unique per call so two users in one test can't collide, and per worker so a
 * `user_email_unique` violation can't cross between databases if the truncate
 * ever stops running. The counter resets with the module, which is per file.
 */
let userCount = 0;

export type TestUser = {
  id: string;
  email: string;
  name: string;
  /**
   * A `cookie` header carrying this user's real session, for handing to a route
   * handler. `requireRole` reads `request.headers` rather than `next/headers`,
   * so a hand-built Request with this on it is all a route test needs — no Next
   * request scope, no route mocking, no HTTP server.
   */
  cookie: string;
};

/**
 * `verified` marks the address confirmed, as clicking the emailed link would.
 * Off by default, like a real sign-up. It matters wherever mail is configured,
 * because sending invites needs it there (`mayInvite`).
 */
export async function createTestUser(
  over: { email?: string; name?: string; verified?: boolean } = {},
): Promise<TestUser> {
  userCount += 1;
  const email = over.email ?? `owner-${process.env.VITEST_POOL_ID ?? "1"}-${userCount}@asaph.test`;
  const name = over.name ?? `Owner ${userCount}`;

  // `asResponse` so the session cookies come back as Better Auth would set them
  // in a browser — signed, and validated by the same code on the way back in.
  // One call gives both the row and the credential; signing in again afterwards
  // would just be a second scrypt verify.
  //
  // Each fixture sign-up comes from its own documentation-range address, so the
  // per-IP sign-up limit (`src/lib/auth/rate-limit.ts`) never counts a test's
  // setup against it. A call with no headers at all would share one bucket, by
  // design, and a test that made more than a handful of users would trip it.
  const response = await auth.api.signUpEmail({
    body: { email, password: TEST_PASSWORD, name },
    headers: new Headers({ "x-forwarded-for": `198.18.${userCount >> 8}.${userCount & 255}` }),
    asResponse: true,
  });
  const { user } = (await response.json()) as { user: { id: string } };
  if (over.verified) await db.update(userTable).set({ emailVerified: true }).where(eq(userTable.id, user.id));

  return { id: user.id, email, name, cookie: cookieHeaderFrom(response) };
}

/**
 * Both cookies Better Auth sets — the signed session token and the short-lived
 * session-data cache — joined the way a browser would send them back.
 */
function cookieHeaderFrom(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

let inviteCount = 0;

/**
 * A `registration_invites` row, inserted directly rather than through the
 * Invite someone flow: the gate only reads the row, and specs for it shouldn't
 * depend on the sending UI or on mail. Pending by default; pass `sentAt` or
 * `usedAt` for the other states.
 */
export async function createRegistrationInvite(
  over: { email?: string; sentAt?: Date; usedAt?: Date; invitedBy?: string } = {},
) {
  inviteCount += 1;
  const [row] = await db
    .insert(registrationInvites)
    .values({
      email: over.email ?? `invited-${process.env.VITEST_POOL_ID ?? "1"}-${inviteCount}@asaph.test`,
      token: nanoid(24),
      invitedBy: over.invitedBy,
      sentAt: over.sentAt,
      usedAt: over.usedAt,
    })
    .returning();
  return row as typeof row & { token: string };
}

/**
 * Three fields covering the shapes the query layer treats differently: the
 * first field is the title (`isTitleField` is positional), a select is what
 * `pickBreakdownField` groups by, and a private field is what public sharing
 * strips. Specs that need a different shape pass their own.
 */
export function testFields(over: FieldDef[] = []): FieldDef[] {
  if (over.length > 0) return over;
  return [
    { id: "title", label: "Title", type: "text", order: 0, origin: "custom" },
    { id: "console", label: "Console", type: "select", order: 1, origin: "custom", options: ["SNES", "NES"] },
    { id: "paid", label: "Paid", type: "currency", order: 2, origin: "custom", private: true },
  ];
}

export function aCollection(params: {
  ownerId: string;
  name?: string;
  fields?: FieldDef[];
  templateKey?: string | null;
}) {
  return createCollection({
    ownerId: params.ownerId,
    name: params.name ?? "Video Games",
    templateKey: params.templateKey ?? null,
    fields: params.fields ?? testFields(),
  });
}

/** The system template the seed put in the template database, by its slugified key. */
export async function systemTemplate(key: string) {
  const row = await db.query.templates.findFirst({
    where: and(eq(templates.key, key)),
  });
  if (!row) throw new Error(`No system template seeded for "${key}"`);
  return row;
}

/**
 * A cover file that really exists, plus its thumbnail, so the delete paths in
 * the query layer can be checked by looking at the filesystem rather than by
 * trusting that they called `deleteUploads`. Returns the URL to store on the
 * item, which is the form `isManagedUpload` accepts.
 */
export async function writeTestUpload(name: string): Promise<string> {
  const dir = process.env.UPLOADS_DIR!;
  // Not a real image: nothing in the delete path decodes one.
  await writeFile(path.join(dir, name), "cover");
  await writeFile(path.join(dir, thumbNameFor(name)), "thumb");
  return `${UPLOAD_URL_PREFIX}${name}`;
}
