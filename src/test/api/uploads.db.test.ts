import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/uploads/[name]/route";
import { apiRequest, routeContext } from "@/test/db/http";
import { UPLOADS_DIR } from "@/test/db/setup";
import { thumbNameFor } from "@/lib/uploads/urls";

/**
 * The one route in the app with no session check at all: covers are rendered by
 * `<img>` on public share pages, which carry no cookie, so the random filename
 * is the capability. That makes `NAME_PATTERN` the entire guard, and these are
 * the probes against it — every one of them has to 404 rather than reach the
 * filesystem.
 *
 * No database is involved, but this file lives in the integration tier because
 * it wants the per-worker `UPLOADS_DIR` and real files on disk.
 */

async function serve(name: string) {
  return GET(apiRequest(`/api/uploads/${name}`), routeContext({ name }));
}

async function writeUpload(name: string, contents = "not-really-an-image") {
  await writeFile(path.join(UPLOADS_DIR, name), contents);
}

describe("serving a stored upload", () => {
  it("answers with the bytes and the sniffed type", async () => {
    await writeUpload("cover0000000000000000.webp", "webp bytes");

    const response = await serve("cover0000000000000000.webp");

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("webp bytes");
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("content-length")).toBe("10");
  });

  it("sends the headers that keep a stored file from being executed or shared", async () => {
    await writeUpload("cover0000000000000000.webp");

    const headers = (await serve("cover0000000000000000.webp")).headers;

    // Names are random and never reused, so the bytes behind a URL can't
    // change — but the cache has to stay private, since the URL is the secret.
    expect(headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    expect(headers.get("x-content-type-options")).toBe("nosniff");
    expect(headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
  });

  it.each([["jpg", "image/jpeg"], ["png", "image/png"], ["gif", "image/gif"], ["avif", "image/avif"]])(
    "serves a .%s as %s",
    async (ext, mime) => {
      await writeUpload(`cover0000000000000000.${ext}`);

      expect((await serve(`cover0000000000000000.${ext}`)).headers.get("content-type")).toBe(mime);
    },
  );

  it("falls back to the full-size file when a thumbnail was never written", async () => {
    // Uploads written before thumbnails existed have no `_t` file. Serving the
    // full-size image beats a broken tile, and it self-corrects on re-upload.
    await writeUpload("legacy00000000000000.webp", "full size");

    const response = await serve(thumbNameFor("legacy00000000000000.webp"));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("full size");
  });

  it("404s a name with no file behind it", async () => {
    expect((await serve("missing0000000000000.webp")).status).toBe(404);
  });

  it("404s a missing thumbnail whose full-size file is missing too", async () => {
    expect((await serve(thumbNameFor("missing0000000000000.webp"))).status).toBe(404);
  });
});

describe("the name guard", () => {
  it.each([
    ["a relative traversal", "../../.env"],
    ["a bare parent", "../secret.png"],
    ["an encoded traversal", "..%2fsecret.png"],
    ["a doubly encoded traversal", "..%252fsecret.png"],
    ["a backslash traversal", "..\\secret.png"],
    ["an absolute posix path", "/etc/passwd"],
    ["an absolute windows path", "C:\\Windows\\win.ini"],
    ["a nested path", "covers/cover0000000000000000.webp"],
    ["a null byte", "cover0000000000000000.webp\0.txt"],
    ["a leading dot", ".env"],
    ["no extension", "cover0000000000000000"],
    ["an svg", "cover0000000000000000.svg"],
    ["an html file", "cover0000000000000000.html"],
    ["a double extension", "cover0000000000000000.png.svg"],
    ["an over-long stem", `${"a".repeat(70)}.webp`],
    ["an empty name", ""],
    ["a space", "cover 0000000000000000.webp"],
  ])("404s %s", async (_label, name) => {
    const response = await serve(name);

    // NAME_PATTERN is anchored and allows only nanoid's alphabet plus one of
    // five image extensions, so none of these can name a path at all.
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
  });

  it("doesn't read the file even when the traversal points at something real", async () => {
    // Written where a naive join from the uploads directory would find it.
    await writeUpload("target00000000000000.webp", "secret");

    const response = await serve("../asaph-test-uploads/target00000000000000.webp");

    expect(response.status).toBe(404);
  });

  it("leaves the directory untouched", async () => {
    // Nothing in this route writes, and a probe shouldn't create anything
    // either — the assertion is cheap and the alternative is not noticing.
    await writeUpload("cover0000000000000000.webp");

    await serve("../../.env");
    await serve("cover0000000000000000.svg");

    expect(await readdir(UPLOADS_DIR)).toEqual(["cover0000000000000000.webp"]);
  });
});
