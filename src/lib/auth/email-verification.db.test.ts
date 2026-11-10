import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { user as userTable } from "@/db/schema";
import { clearRateLimit } from "@/db/queries/auth-rate-limits";
import { createTestUser, TEST_PASSWORD } from "@/test/db/fixtures";
import { signedInAs } from "@/test/db/session";

/**
 * Address confirmation, end to end: the email on sign-up, the link it carries,
 * and following that link through Better Auth's real `/verify-email`.
 *
 * Whether it's wired in at all is decided when `auth.ts` is evaluated (mail
 * and BETTER_AUTH_URL both set), so both are set before anything imports it.
 * The transport is mocked at the `sendEmail` seam.
 */
const previousAuthUrl = vi.hoisted(() => {
  const previous = process.env.BETTER_AUTH_URL;
  process.env.SMTP_HOST = "smtp.asaph.test";
  process.env.EMAIL_FROM = "Asaph <asaph@asaph.test>";
  process.env.BETTER_AUTH_URL = "https://asaph.example.com";
  return previous;
});

afterAll(() => {
  process.env.BETTER_AUTH_URL = previousAuthUrl;
});

const mail = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@/lib/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email")>()),
  sendEmail: mail.send,
}));

vi.mock("next/headers", async () => {
  const { sessionHeaders } = await import("@/test/db/session");
  return { headers: async () => sessionHeaders() };
});

const { auth } = await import("./auth");
const { sendVerificationEmail } = await import("./email-verification");
const { sendVerificationEmailAction } = await import("@/actions/account");

beforeEach(() => {
  mail.send.mockReset().mockResolvedValue("sent");
});

/** The link from the one verification email sent so far. */
function linkFromMail(): string {
  expect(mail.send).toHaveBeenCalledOnce();
  const match = (mail.send.mock.calls[0][0].text as string).match(/https:\/\/\S+/);
  return match![0];
}

async function emailVerified(id: string): Promise<boolean> {
  const row = await db.query.user.findFirst({ where: eq(userTable.id, id) });
  return row!.emailVerified;
}

describe("on sign-up", () => {
  it("emails a link on BETTER_AUTH_URL, whatever host the request claims", async () => {
    const { user } = await auth.api.signUpEmail({
      body: { email: "new@asaph.test", password: TEST_PASSWORD, name: "New" },
      headers: new Headers({ host: "evil.example", "x-forwarded-host": "evil.example", "x-forwarded-for": "198.51.100.1" }),
    });

    const link = new URL(linkFromMail());
    expect(link.origin).toBe("https://asaph.example.com");
    expect(link.pathname).toBe("/api/auth/verify-email");
    expect(link.searchParams.get("callbackURL")).toBe("/account?verified=1");
    expect(link.searchParams.get("token")).toBeTruthy();
    expect(await emailVerified(user.id)).toBe(false);
  });
});

describe("following the link", () => {
  it("confirms the address and lands on the account page", async () => {
    const someone = await createTestUser();
    const response = await auth.handler(new Request(linkFromMail()));

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/account?verified=1");
    expect(await emailVerified(someone.id)).toBe(true);
  });

  it("refuses a token that isn't one, and says so on the way back", async () => {
    const someone = await createTestUser();
    const forged = new URL(linkFromMail());
    forged.searchParams.set("token", "not-a-token");

    const response = await auth.handler(new Request(forged));

    expect(response.headers.get("location")).toContain("error=");
    expect(await emailVerified(someone.id)).toBe(false);
  });
});

describe("sendVerificationEmail", () => {
  it("sends nothing to an address that's already confirmed", async () => {
    await sendVerificationEmail({ user: { id: "u1", email: "done@asaph.test", emailVerified: true }, token: "t" });
    expect(mail.send).not.toHaveBeenCalled();
  });

  it("sends at most one a minute per account, however it's asked for", async () => {
    const account = { id: "u2", email: "again@asaph.test", emailVerified: false };
    const logged = vi.spyOn(console, "log").mockImplementation(() => {});

    await sendVerificationEmail({ user: account, token: "t1" });
    await sendVerificationEmail({ user: account, token: "t2" });

    expect(mail.send).toHaveBeenCalledOnce();
    expect(logged).toHaveBeenCalledWith(expect.stringContaining("not sent"));
    logged.mockRestore();
  });
});

describe("sendVerificationEmailAction", () => {
  it("sends the signed-in account a fresh link", async () => {
    const someone = await createTestUser();
    // Its sign-up email started the cooldown; clear it as a minute passing would.
    await clearRateLimit(`verify-email:user:${someone.id}`);
    mail.send.mockClear();
    signedInAs(someone);

    expect(await sendVerificationEmailAction()).toEqual({ ok: true });
    expect(mail.send.mock.calls[0][0].to).toBe(someone.email);
  });

  it("answers the same inside the cooldown, and sends nothing", async () => {
    const someone = await createTestUser();
    mail.send.mockClear();
    signedInAs(someone);
    const logged = vi.spyOn(console, "log").mockImplementation(() => {});

    expect(await sendVerificationEmailAction()).toEqual({ ok: true });
    expect(mail.send).not.toHaveBeenCalled();
    logged.mockRestore();
  });

  it("is done already for a confirmed account", async () => {
    const someone = await createTestUser({ verified: true });
    signedInAs(someone);

    expect(await sendVerificationEmailAction()).toEqual({ ok: true });
  });
});
