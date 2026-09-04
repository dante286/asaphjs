import { describe, expect, it } from "vitest";
import {
  NAME_PATTERN,
  THUMB_SUFFIX,
  UPLOAD_URL_PREFIX,
  fullNameForThumb,
  isManagedUpload,
  isThumbName,
  thumbNameFor,
  thumbUrlFor,
} from "./urls";

const managed = (name: string) => `${UPLOAD_URL_PREFIX}${name}`;

describe("NAME_PATTERN", () => {
  it("accepts a name from nanoid's alphabet with an allowed extension", () => {
    expect(NAME_PATTERN.test("V1StGXR8Z5jdHi6BmyT.jpg")).toBe(true);
    expect(NAME_PATTERN.test("a-b_c.webp")).toBe(true);
  });

  it.each(["jpg", "png", "webp", "gif", "avif"])("accepts .%s", (ext) => {
    expect(NAME_PATTERN.test(`abc.${ext}`)).toBe(true);
  });

  // This pattern is the path-traversal guard: the read route joins the name it
  // matches onto the uploads directory, so anything that could escape that
  // directory, or name a file type the route would then serve with an attacker's
  // Content-Type, has to fail here.
  it.each([
    ["a traversal segment", "../secrets.jpg"],
    ["a nested traversal", "..%2F..%2Fsecrets.jpg"],
    ["a path separator", "sub/dir.jpg"],
    ["a backslash separator", "sub\\dir.jpg"],
    ["a leading dot with no stem", ".jpg"],
    ["an absolute path", "/etc/passwd.jpg"],
    ["a percent-encoded dot", "%2e%2e.jpg"],
    ["a null byte", "abc\0.jpg"],
    ["a trailing newline", "abc.jpg\n"],
    ["a space", "my photo.jpg"],
    ["a query string", "abc.jpg?raw=1"],
    ["a double extension", "abc.jpg.exe"],
    ["an svg", "abc.svg"],
    ["no extension", "abc"],
    ["an empty name", ""],
  ])("rejects %s", (_label, name) => {
    expect(NAME_PATTERN.test(name)).toBe(false);
  });

  it("is case-sensitive about the extension", () => {
    // The extension is echoed back as the response Content-Type, so the set of
    // accepted spellings stays exactly the set the route knows how to map.
    expect(NAME_PATTERN.test("abc.JPG")).toBe(false);
  });

  it("caps the stem at 64 characters", () => {
    expect(NAME_PATTERN.test(`${"a".repeat(64)}.jpg`)).toBe(true);
    expect(NAME_PATTERN.test(`${"a".repeat(65)}.jpg`)).toBe(false);
  });
});

describe("isManagedUpload", () => {
  it("accepts a URL this store minted", () => {
    expect(isManagedUpload(managed("V1StGXR8Z5jdHi6BmyT.webp"))).toBe(true);
  });

  it("accepts a thumb URL without loosening the pattern", () => {
    // `_` is in nanoid's alphabet, which is why the thumb suffix needed no
    // change to the guard.
    expect(isManagedUpload(managed(`V1StGXR8Z5jdHi6BmyT${THUMB_SUFFIX}.webp`))).toBe(true);
  });

  it.each([
    ["a provider cover", "https://images.igdb.com/igdb/image/upload/t_cover_big/abc.jpg"],
    ["an off-prefix path", "/api/other/abc.jpg"],
    ["an absolute URL that merely contains the prefix", "https://evil.example/api/uploads/abc.jpg"],
    ["a traversal below the prefix", "/api/uploads/../../.env"],
    ["the bare prefix", UPLOAD_URL_PREFIX],
  ])("rejects %s", (_label, url) => {
    expect(isManagedUpload(url)).toBe(false);
  });

  it.each([null, undefined, ""])("rejects %j without throwing", (url) => {
    expect(isManagedUpload(url)).toBe(false);
  });
});

describe("thumb naming", () => {
  it("derives a thumb name from a full name", () => {
    expect(thumbNameFor("abc.webp")).toBe("abc_t.webp");
  });

  it("round-trips back to the full name", () => {
    expect(fullNameForThumb(thumbNameFor("abc.webp"))).toBe("abc.webp");
  });

  it("tells a thumb from a full name", () => {
    expect(isThumbName("abc_t.webp")).toBe(true);
    expect(isThumbName("abc.webp")).toBe(false);
  });

  it("keeps a thumb name inside the 64-character stem cap for a real id", () => {
    // nanoid ids are 21 characters and a thumb stem is 23, so the derived name
    // is still a name the read route will serve.
    const id = "V1StGXR8Z5jdHi6BmyT12";
    expect(id).toHaveLength(21);
    expect(isManagedUpload(managed(thumbNameFor(`${id}.webp`)))).toBe(true);
  });
});

describe("thumbUrlFor", () => {
  it("points a managed full-size URL at its thumb", () => {
    expect(thumbUrlFor(managed("abc.webp"))).toBe(managed("abc_t.webp"));
  });

  it("is idempotent on a URL that already names a thumb", () => {
    expect(thumbUrlFor(managed("abc_t.webp"))).toBe(managed("abc_t.webp"));
  });

  it("hands back a provider URL untouched", () => {
    // There's no derivative to point at, and rewriting it would 404.
    const provider = "https://covers.openlibrary.org/b/id/123-L.jpg";
    expect(thumbUrlFor(provider)).toBe(provider);
  });

  it.each([null, undefined, ""])("maps %j to null", (url) => {
    expect(thumbUrlFor(url)).toBeNull();
  });
});
