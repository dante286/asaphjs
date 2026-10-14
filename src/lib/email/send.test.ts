import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The capture transport. `sendEmail` builds its transport with nodemailer's
 * `createTransport`, so that's the seam: this records the options it was
 * handed, then returns nodemailer's own stream transport instead of an SMTP
 * one. The message is still composed by nodemailer for real — headers,
 * multipart body and all — and lands in `raw` rather than on a socket.
 */
const capture = vi.hoisted(() => ({
  options: [] as unknown[],
  raw: [] as string[],
  fail: null as Error | null,
}));

vi.mock("nodemailer", async (importOriginal) => {
  const real = await importOriginal<typeof import("nodemailer")>();
  return {
    ...real,
    createTransport: vi.fn((options: unknown) => {
      capture.options.push(options);
      const stream = real.createTransport({ streamTransport: true, buffer: true });
      return {
        sendMail: async (mail: Parameters<typeof stream.sendMail>[0]) => {
          if (capture.fail) throw capture.fail;
          const info = await stream.sendMail(mail);
          capture.raw.push(info.message.toString());
          return info;
        },
      };
    }),
  };
});

const { sendEmail } = await import("./send");

const message = {
  to: "friend@example.com",
  subject: "You're invited to Vinyl",
  text: "Open http://localhost:3000/invite/abc123 to accept.",
  html: '<p><a href="http://localhost:3000/invite/abc123">Accept</a></p>',
};

const SMTP_VARS = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "EMAIL_FROM"];

beforeEach(() => {
  for (const name of SMTP_VARS) vi.stubEnv(name, undefined);
  capture.options = [];
  capture.raw = [];
  capture.fail = null;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("sendEmail with no transport configured", () => {
  it("logs the message instead, and builds no transport", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    expect(await sendEmail(message)).toBe("not_configured");

    expect(capture.options).toEqual([]);
    expect(log).toHaveBeenCalledTimes(1);
    const printed = log.mock.calls[0][0] as string;
    // The link has to be in it: on an instance with no mail, the log line is
    // the only way the invite reaches anyone.
    expect(printed).toContain("friend@example.com");
    expect(printed).toContain("You're invited to Vinyl");
    expect(printed).toContain("http://localhost:3000/invite/abc123");
  });

  it("falls back the same way with only half the switch set", async () => {
    vi.stubEnv("SMTP_HOST", "smtp.example.com");
    vi.spyOn(console, "log").mockImplementation(() => {});

    expect(await sendEmail(message)).toBe("not_configured");
    expect(capture.options).toEqual([]);
  });
});

describe("sendEmail with a transport configured", () => {
  beforeEach(() => {
    vi.stubEnv("SMTP_HOST", "smtp.resend.com");
    vi.stubEnv("SMTP_USER", "resend");
    vi.stubEnv("SMTP_PASSWORD", "re_AbC123_xyz");
    vi.stubEnv("EMAIL_FROM", "Asaph <asaph@example.com>");
  });

  it("sends a multipart message from EMAIL_FROM and logs nothing", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    expect(await sendEmail(message)).toBe("sent");

    expect(log).not.toHaveBeenCalled();
    expect(capture.raw).toHaveLength(1);
    const raw = capture.raw[0];
    expect(raw).toMatch(/^From: Asaph <asaph@example\.com>$/m);
    expect(raw).toMatch(/^To: friend@example\.com$/m);
    expect(raw).toMatch(/^Subject: You're invited to Vinyl$/m);
    // Both parts, as alternatives of each other: the text part is a real one.
    expect(raw).toMatch(/^Content-Type: multipart\/alternative/m);
    expect(raw).toMatch(/^Content-Type: text\/plain/m);
    expect(raw).toMatch(/^Content-Type: text\/html/m);
  });

  it("builds the transport from the environment, STARTTLS required", async () => {
    await sendEmail(message);

    expect(capture.options).toEqual([
      expect.objectContaining({
        host: "smtp.resend.com",
        port: 587,
        secure: false,
        requireTLS: true,
        auth: { user: "resend", pass: "re_AbC123_xyz" },
      }),
    ]);
  });

  it("throws when the send fails, and leaves the answer to the caller", async () => {
    capture.fail = Object.assign(new Error("535 5.7.3 Authentication unsuccessful"), {
      code: "EAUTH",
    });

    await expect(sendEmail(message)).rejects.toThrow("Authentication unsuccessful");
  });

  it("throws on a bad SMTP_PORT rather than falling back to the console", async () => {
    // Half-working config shouldn't look like no config: the operator set mail
    // up and should hear that it's broken, not find links in a log.
    vi.stubEnv("SMTP_PORT", "five-eight-seven");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(sendEmail(message)).rejects.toThrow(/SMTP_PORT/);
    expect(log).not.toHaveBeenCalled();
  });
});
