import { describe, expect, it } from "vitest";
import { passwordResetEmail } from "./password-reset";

describe("passwordResetEmail", () => {
  const message = passwordResetEmail({
    to: "friend@example.com",
    url: "https://asaph.example.com/auth/reset?token=abc123",
    expiresInMinutes: 60,
  });

  it("carries the link, the lifetime and what resetting does, in both parts", () => {
    expect(message.to).toBe("friend@example.com");
    expect(message.subject).toBe("Reset your Asaph password");
    for (const part of [message.text, message.html]) {
      expect(part).toContain("https://asaph.example.com/auth/reset?token=abc123");
      expect(part).toContain("expires in 60 minutes");
      expect(part).toContain("signs out every device");
      // For the person who didn't ask: nothing has happened yet.
      expect(part).toContain("your password hasn't changed");
    }
    expect(message.html).toContain('href="https://asaph.example.com/auth/reset?token=abc123"');
  });
});
