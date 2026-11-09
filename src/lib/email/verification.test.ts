import { describe, expect, it } from "vitest";
import { verificationEmail } from "./verification";

describe("verificationEmail", () => {
  const url = "https://asaph.example.com/api/auth/verify-email?token=abc.def&callbackURL=%2Faccount";
  const message = verificationEmail({ to: "friend@example.com", url, expiresInMinutes: 60 });

  it("carries the link, its lifetime and what verifying unlocks, in both parts", () => {
    expect(message.to).toBe("friend@example.com");
    expect(message.subject).toBe("Confirm your email address for Asaph");
    expect(message.text).toContain(url);
    for (const part of [message.text, message.html]) {
      expect(part).toContain("expires in 60 minutes");
      expect(part).toContain("can't send invites");
    }
  });

  it("escapes the link's ampersand in the HTML part", () => {
    const escaped = url.replace("&", "&amp;");
    expect(message.html).toContain(`href="${escaped}"`);
    expect(message.html).not.toContain(url);
  });
});
