import { describe, expect, it } from "vitest";
import { inviteEmail } from "./invite";

const base = {
  to: "friend@example.com",
  inviterName: "Dana",
  collectionName: "Vinyl",
  role: "viewer" as const,
  url: "https://asaph.example.com/invite/abc123",
  expiresInDays: 14,
};

describe("inviteEmail", () => {
  it("names the inviter, the collection, the link and how long it lasts", () => {
    const message = inviteEmail(base);

    expect(message.to).toBe("friend@example.com");
    expect(message.subject).toBe("Dana shared Vinyl with you");
    for (const part of [message.text, message.html]) {
      expect(part).toContain("https://asaph.example.com/invite/abc123");
      expect(part).toContain("expires in 14 days");
      // Acceptance checks the address, so the email says which one to use.
      expect(part).toContain("friend@example.com");
    }
    expect(message.html).toContain('href="https://asaph.example.com/invite/abc123"');
  });

  it("says what the role allows", () => {
    expect(inviteEmail(base).text).toContain("invited you to view their collection");
    expect(inviteEmail({ ...base, role: "editor" }).text).toContain("invited you to view and edit their collection");
  });

  it("escapes the names in the HTML part", () => {
    // Both are typed by a user, and the HTML part is rendered by someone else's
    // mail client.
    const message = inviteEmail({ ...base, inviterName: "<b>Dana</b>", collectionName: 'Vinyl <img src=x onerror="x">' });

    expect(message.html).not.toContain("<b>Dana</b>");
    expect(message.html).not.toContain("<img");
    expect(message.html).toContain("&lt;b&gt;Dana&lt;/b&gt;");
    expect(message.html).toContain("Vinyl &lt;img src=x onerror=&quot;x&quot;&gt;");
    // The text part is text/plain; escaping it would only garble the name.
    expect(message.text).toContain('Vinyl <img src=x onerror="x">');
  });

  it("keeps the subject on one line", () => {
    expect(inviteEmail({ ...base, collectionName: "Vinyl\r\nBcc: someone@example.com" }).subject).toBe(
      "Dana shared Vinyl Bcc: someone@example.com with you",
    );
  });
});
