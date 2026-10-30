import { describe, expect, it } from "vitest";
import { registrationInviteEmail } from "./registration-invite";

const base = {
  to: "friend@example.com",
  inviterName: "Dana",
  url: "https://asaph.example.com/join/abc123",
  expiresInDays: 14,
};

describe("registrationInviteEmail", () => {
  it("names the inviter, the link, who it's for and how long it lasts", () => {
    const message = registrationInviteEmail(base);

    expect(message.to).toBe("friend@example.com");
    expect(message.subject).toBe("Dana invited you to Asaph");
    for (const part of [message.text, message.html]) {
      expect(part).toContain("https://asaph.example.com/join/abc123");
      expect(part).toContain("works once, for friend@example.com, and expires in 14 days");
    }
    expect(message.html).toContain('href="https://asaph.example.com/join/abc123"');
  });

  it("escapes the inviter's name in the HTML part only", () => {
    const message = registrationInviteEmail({ ...base, inviterName: "<img src=x onerror=alert(1)>" });

    expect(message.html).not.toContain("<img");
    expect(message.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(message.text).toContain("<img src=x onerror=alert(1)> invited you");
  });

  it("keeps the subject on one line whatever the name holds", () => {
    expect(registrationInviteEmail({ ...base, inviterName: "Dana\r\nBcc: everyone" }).subject).toBe(
      "Dana Bcc: everyone invited you to Asaph",
    );
  });
});
