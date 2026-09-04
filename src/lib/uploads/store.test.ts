import { describe, expect, it } from "vitest";
import { MAX_DIMENSION, THUMB_DIMENSION, sniffImageExt } from "./store";

/** Bytes with the given prefix, padded to at least the 12-byte minimum. */
function header(...parts: (number[] | string)[]): Uint8Array {
  const bytes: number[] = [];
  for (const part of parts) {
    if (typeof part === "string") bytes.push(...[...part].map((c) => c.charCodeAt(0)));
    else bytes.push(...part);
  }
  while (bytes.length < 16) bytes.push(0);
  return new Uint8Array(bytes);
}

// The extension this returns is what the read route hands back as the
// response's Content-Type, so it has to come from the container bytes rather
// than from the browser's claim about them.

describe("sniffImageExt", () => {
  it("recognises a JPEG by its SOI marker", () => {
    expect(sniffImageExt(header([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpg");
  });

  it("recognises a PNG by its signature", () => {
    expect(sniffImageExt(header([0x89], "PNG\r\n", [0x1a, 0x0a]))).toBe("png");
  });

  it("recognises a WebP by RIFF plus the WEBP form type", () => {
    // The form type is at offset 8, past the four-byte length — RIFF alone
    // would also match a WAV file.
    expect(sniffImageExt(header("RIFF", [0, 0, 0, 0], "WEBP"))).toBe("webp");
  });

  it("rejects a RIFF container that isn't WebP", () => {
    expect(sniffImageExt(header("RIFF", [0, 0, 0, 0], "WAVE"))).toBeNull();
  });

  it.each(["GIF87a", "GIF89a"])("recognises a %s GIF", (magic) => {
    expect(sniffImageExt(header(magic))).toBe("gif");
  });

  it.each(["avif", "avis"])("recognises an ISO-BMFF box with the %s brand", (brand) => {
    expect(sniffImageExt(header([0, 0, 0, 0x20], "ftyp", brand))).toBe("avif");
  });

  it("rejects an ISO-BMFF box with a brand we don't serve", () => {
    // An MP4 shares the ftyp box, so the brand is what separates them.
    expect(sniffImageExt(header([0, 0, 0, 0x20], "ftyp", "mp42"))).toBeNull();
  });

  it.each([
    ["an SVG", "<svg xmlns='http://www.w3.org/2000/svg'>"],
    ["HTML", "<!DOCTYPE html><html><body>hi</body></html>"],
    ["plain text", "this is not an image at all"],
  ])("rejects %s", (_label, text) => {
    // An SVG would be served back as markup from this app's own origin, so it
    // has to fail here rather than in the decoder.
    expect(sniffImageExt(header(text))).toBeNull();
  });

  it("rejects anything shorter than 12 bytes without reading past the end", () => {
    // A truncated upload can't be identified, and the AVIF check reads offset
    // 8 through 11.
    expect(sniffImageExt(new Uint8Array([0xff, 0xd8, 0xff]))).toBeNull();
    expect(sniffImageExt(new Uint8Array())).toBeNull();
  });

  it("only looks at the header, so a valid magic with junk after it still passes", () => {
    // It's a cheap structural reject, not validation — sharp is what actually
    // decides the bytes are a decodable image.
    const bytes = header([0xff, 0xd8, 0xff, 0xe0]);
    bytes.fill(0x7f, 12);

    expect(sniffImageExt(bytes)).toBe("jpg");
  });
});

describe("resize bounds", () => {
  it("keeps the thumbnail smaller than the full-size bound", () => {
    // Both are derived from real frame widths in the UI; if these ever crossed,
    // the thumb would be an upscale of the bounded copy.
    expect(THUMB_DIMENSION).toBeLessThan(MAX_DIMENSION);
  });
});
