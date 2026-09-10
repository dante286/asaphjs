import { describe, expect, it, vi } from "vitest";

// `requestOrigin` is the whole reason the container image needs no build-time
// origin: it derives one per request instead of reading a baked-in constant.
// The mock is the request's header bag and nothing else, which is all the
// function touches.
const headerBag = vi.hoisted(() => ({ current: new Headers() }));

vi.mock("next/headers", () => ({
  headers: async () => headerBag.current,
}));

const { requestOrigin } = await import("./request-origin");

/** Resolve the origin as if the request had arrived carrying these headers. */
async function originFor(headers: Record<string, string>): Promise<string> {
  headerBag.current = new Headers(headers);
  return requestOrigin();
}

describe("requestOrigin: the host it answers on", () => {
  it("uses Host when nothing is proxying", async () => {
    expect(await originFor({ host: "asaph.example.com" })).toBe("https://asaph.example.com");
  });

  it("prefers x-forwarded-host over Host", async () => {
    // The reverse-proxy case: Host is the container's internal name, and the
    // address anyone could paste is the one the proxy was asked for.
    expect(
      await originFor({ host: "asaph:3000", "x-forwarded-host": "books.example.com" }),
    ).toBe("https://books.example.com");
  });

  it("falls back to localhost:3000 when the request carries no host at all", async () => {
    expect(await originFor({})).toBe("http://localhost:3000");
  });
});

describe("requestOrigin: the scheme it guesses", () => {
  it("honours x-forwarded-proto over the loopback rule", async () => {
    // A proxy terminating TLS in front of a plain-HTTP container, which is the
    // usual deployment. Also the case where guessing would be wrong.
    expect(await originFor({ host: "asaph.example.com", "x-forwarded-proto": "http" })).toBe(
      "http://asaph.example.com",
    );
    expect(await originFor({ host: "localhost:3000", "x-forwarded-proto": "https" })).toBe(
      "https://localhost:3000",
    );
  });

  it.each([
    ["localhost", "http://localhost"],
    ["localhost:3000", "http://localhost:3000"],
    ["127.0.0.1", "http://127.0.0.1"],
    ["127.0.0.1:3000", "http://127.0.0.1:3000"],
    ["[::1]:3000", "http://[::1]:3000"],
  ])("guesses http for the loopback host %s", async (host, expected) => {
    expect(await originFor({ host })).toBe(expected);
  });

  it.each([
    // Anything reachable by name should be https, and a wrong guess here ends
    // up in someone's clipboard — so these must not be mistaken for loopback.
    ["asaph.example.com", "https://asaph.example.com"],
    ["192.168.1.10:3000", "https://192.168.1.10:3000"],
    // Substring traps: a name that merely contains or extends a loopback one.
    ["localhost.evil.example", "https://localhost.evil.example"],
    ["notlocalhost", "https://notlocalhost"],
    ["127.0.0.1.evil.example", "https://127.0.0.1.evil.example"],
  ])("guesses https for the non-loopback host %s", async (host, expected) => {
    expect(await originFor({ host })).toBe(expected);
  });
});
