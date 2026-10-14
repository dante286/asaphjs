import { createTransport } from "nodemailer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startFakeSmtp, type FakeSmtp } from "@/test/email/fake-smtp";
import { emailConfigured, smtpConfig, tlsMode, transportOptions } from "./config";

// Every case stubs all five variables, so the suite says the same thing on a
// machine with a populated .env as it does in a clean checkout.
const VARS = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "EMAIL_FROM"] as const;

function env(values: Partial<Record<(typeof VARS)[number], string>>) {
  for (const name of VARS) vi.stubEnv(name, values[name]);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("emailConfigured: the switch between real mail and the console", () => {
  it("is off with nothing set", () => {
    env({});
    expect(emailConfigured()).toBe(false);
    expect(smtpConfig()).toBeNull();
  });

  it("is on with a host and a sender, and nothing else", () => {
    env({ SMTP_HOST: "smtp.example.com", EMAIL_FROM: "asaph@example.com" });
    expect(emailConfigured()).toBe(true);
  });

  it.each([
    ["host without a sender", { SMTP_HOST: "smtp.example.com" }],
    ["sender without a host", { EMAIL_FROM: "asaph@example.com" }],
    // Full credentials but nowhere to send them is still unconfigured — it
    // shouldn't take a host to make the console fallback stop.
    ["credentials alone", { SMTP_USER: "u", SMTP_PASSWORD: "p", EMAIL_FROM: "" }],
  ])("is off for a %s", (_, values) => {
    env(values);
    expect(emailConfigured()).toBe(false);
    expect(smtpConfig()).toBeNull();
  });

  it("treats whitespace as unset", () => {
    // A `SMTP_HOST= ` line in an env file is someone who meant to leave it
    // blank, not a host named " ".
    env({ SMTP_HOST: "  ", EMAIL_FROM: "asaph@example.com" });
    expect(emailConfigured()).toBe(false);
  });
});

describe("smtpConfig: reading the variables", () => {
  it("defaults the port to 587", () => {
    env({ SMTP_HOST: "smtp.example.com", EMAIL_FROM: "asaph@example.com" });
    expect(smtpConfig()?.port).toBe(587);
  });

  it.each(["abc", "0", "70000", "587.5"])("rejects SMTP_PORT=%j by name", (port) => {
    env({ SMTP_HOST: "smtp.example.com", SMTP_PORT: port, EMAIL_FROM: "a@example.com" });
    expect(() => smtpConfig()).toThrow(/SMTP_PORT/);
  });

  it("sends no AUTH when there's no user, for a relay that wants none", () => {
    env({ SMTP_HOST: "localhost", SMTP_PORT: "1025", EMAIL_FROM: "a@example.com" });
    expect(smtpConfig()?.auth).toBeUndefined();
  });

  it("passes the password through untouched", () => {
    // The reason these are discrete variables: an SES SMTP password is base64,
    // and the `/`, `+` and `%` a URL would have needed encoded arrive as-is.
    const secret = "BKh7/q+Zr3%2Fx9Lw/T+0aBcD=";
    env({
      SMTP_HOST: "email-smtp.us-east-1.amazonaws.com",
      SMTP_USER: "AKIAEXAMPLE",
      SMTP_PASSWORD: secret,
      EMAIL_FROM: "asaph@example.com",
    });
    expect(smtpConfig()?.auth).toEqual({ user: "AKIAEXAMPLE", pass: secret });
  });

  it("trims a stray space off the password", () => {
    env({
      SMTP_HOST: "smtp.resend.com",
      SMTP_USER: "resend",
      SMTP_PASSWORD: "re_AbC123_xyz ",
      EMAIL_FROM: "asaph@example.com",
    });
    expect(smtpConfig()?.auth?.pass).toBe("re_AbC123_xyz");
  });

  it("refuses a password with no user", () => {
    env({ SMTP_HOST: "smtp.example.com", SMTP_PASSWORD: "p", EMAIL_FROM: "a@example.com" });
    expect(() => smtpConfig()).toThrow(/SMTP_USER/);
  });
});

describe("tlsMode: the port decides, unless the host is loopback", () => {
  it.each([
    ["smtp.resend.com", 465, "implicit"],
    ["smtp.resend.com", 587, "starttls"],
    // Resend's fallback for hosts that block 587 — the README points there,
    // not at 2465, which is implicit TLS on a port this rule doesn't know.
    ["smtp.resend.com", 2587, "starttls"],
    ["smtp.example.com", 25, "starttls"],
    ["smtp.example.com", 2525, "starttls"],
    ["smtp.example.com", 465, "implicit"],
    ["localhost", 1025, "none"],
    ["127.0.0.1", 25, "none"],
    ["::1", 25, "none"],
    ["[::1]", 25, "none"],
    // 465 means the server speaks TLS from the first byte; loopback or not,
    // plaintext would fail.
    ["localhost", 465, "implicit"],
  ] as const)("%s:%i is %s", (host, port, mode) => {
    expect(tlsMode(host, port)).toBe(mode);
  });

  it.each(["localhost.evil.example", "127.0.0.1.nip.io", "mailpit"])(
    "requires STARTTLS from %s, which only looks local",
    (host) => {
      expect(tlsMode(host, 587)).toBe("starttls");
    },
  );
});

/**
 * The mapping above is only worth anything if nodemailer reads the keys it
 * produces — `requireTls` instead of `requireTLS` would pass every assertion
 * above and send in the clear. So these hand `transportOptions`' output to the
 * real SMTP client and point it at a server that offers no encryption at all.
 * Only the address is overridden, to reach the fake; every TLS-related key is
 * exactly what production would use for the host named.
 */
describe("transportOptions: a real client against a server with no TLS", () => {
  let fake: FakeSmtp;

  afterEach(async () => {
    await fake?.close();
  });

  async function sendVia(host: string, port: number, { advertiseStartTls = false } = {}) {
    fake = await startFakeSmtp({ advertiseStartTls });
    const options = transportOptions({ host, port, from: "asaph@example.com" });
    const transport = createTransport({ ...options, host: "127.0.0.1", port: fake.port });
    return transport.sendMail({
      from: "asaph@example.com",
      to: "someone@example.com",
      subject: "token inside",
      text: "secret-reset-token",
    });
  }

  it("refuses to send when a STARTTLS host doesn't offer it", async () => {
    await expect(sendVia("smtp.example.com", 587)).rejects.toThrow();

    // It got as far as asking what the server supports, and no further: no
    // sender, no recipient, and above all no body went over the wire.
    expect(fake.commands.some((c) => c.startsWith("EHLO"))).toBe(true);
    expect(fake.commands.some((c) => c.startsWith("MAIL FROM"))).toBe(false);
    expect(fake.messages).toEqual([]);
  });

  it("speaks TLS from the first byte on 465", async () => {
    await expect(sendVia("smtp.example.com", 465)).rejects.toThrow();

    // A TLS ClientHello isn't a line of SMTP, so the server never sees EHLO.
    expect(fake.commands.some((c) => c.startsWith("EHLO"))).toBe(false);
    expect(fake.messages).toEqual([]);
  });

  it("sends in plaintext to a loopback relay", async () => {
    await sendVia("localhost", 1025);

    expect(fake.messages).toHaveLength(1);
    expect(fake.messages[0]).toContain("secret-reset-token");
  });

  it("doesn't attempt STARTTLS on loopback even when it's advertised", async () => {
    // The local relay with a self-signed certificate: trying the upgrade would
    // fail verification, and on loopback it would protect nothing anyway.
    await sendVia("localhost", 25, { advertiseStartTls: true });

    expect(fake.commands).not.toContain("STARTTLS");
    expect(fake.messages).toHaveLength(1);
  });
}, 15_000);
