import path from "node:path";
import { expect, test } from "@playwright/test";
import { addItem, createCollection, openItem, signUp, unique } from "./helpers";

/**
 * The spec this whole tier was added for.
 *
 * `next build` and `tsc` both pass on a standalone output that cannot serve a
 * photo: the tracer follows `@img/sharp-<platform>/lib/*.node` but not the
 * `libvips-cpp.so.*` that binary dlopens, so the upload route throws
 * ERR_DLOPEN_FAILED the first time anyone posts an image.
 * `outputFileTracingIncludes` in next.config.ts is the fix; this is the thing
 * that notices when it stops being there.
 *
 * A libvips that didn't make it into the image turns this spec red — verified
 * by building one with `@img` deleted and watching it fail. Worth knowing when
 * reading a failure, though: item creation mirrors provider cover art through
 * the same pipeline, so `addItem` goes down first and three specs fail at once
 * with a dialog that never closed. The reason is only in the container log,
 * which is why the CI job prints it on failure.
 *
 * One upload also settles four other questions at once: that the WebP
 * re-encode ran, that the thumbnail was written beside its full-size pair, that
 * `UPLOADS_DIR` is honoured, and that the read route serves files from outside
 * `public/`.
 */

// `__dirname` rather than `import.meta`: Playwright transpiles these specs to
// CommonJS, since package.json declares no module type.
const FIXTURE = path.join(__dirname, "fixtures", "shelf-photo.png");

/** nanoid's default length, and the alphabet NAME_PATTERN allows. */
const UPLOAD_URL = /^\/api\/uploads\/[A-Za-z0-9_-]{21}\.webp$/;

test("an uploaded photo is re-encoded, paired with a thumbnail, and served back", async ({
  page,
  request,
}) => {
  await signUp(page);
  await createCollection(page, { name: unique("Photo Smoke"), template: "Video Games" });
  await addItem(page, { title: "Chrono Trigger" });
  await openItem(page, "Chrono Trigger");

  // The picker is a hidden input the cover frame clicks for you; setInputFiles
  // doesn't need it visible, and driving the OS file dialog isn't a thing.
  await page.locator('input[type="file"]').setInputFiles(FIXTURE);

  const cover = page.locator('img[src^="/api/uploads/"]');
  await expect(cover).toBeVisible();

  const fullUrl = await cover.getAttribute("src");
  expect(fullUrl).toMatch(UPLOAD_URL);

  /**
   * The thumb name is rebuilt here rather than imported from
   * `@/lib/uploads/urls`: the covers grid asks for `<id>_t.webp` over HTTP, and
   * a spec that imported the same helper the server uses would agree with it by
   * construction even if the pair on disk were never written.
   */
  const thumbUrl = fullUrl!.replace(/\.webp$/, "_t.webp");

  for (const url of [fullUrl!, thumbUrl]) {
    // `request` carries no session cookie, which is the read route's documented
    // contract — public share pages render these covers with no session at all.
    const response = await request.get(url);
    expect(response.status(), `GET ${url}`).toBe(200);
    expect(response.headers()["content-type"]).toBe("image/webp");

    // The extension is what the route derives its Content-Type from, and
    // store.ts hardcodes `.webp`, so the header alone would say nothing about
    // the bytes. The container signature is what proves libvips encoded them.
    const bytes = await response.body();
    expect(bytes.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(bytes.subarray(8, 12).toString("ascii")).toBe("WEBP");
  }

  // Both URLs resolving is not quite enough on its own: the read route falls
  // back to the full-size file for a `_t` name that isn't on disk, so uploads
  // predating thumbnails still render. That fallback would make a missing
  // thumbnail look like a passing test — a strictly smaller body is what
  // separates a real derivative from the same file served twice.
  const full = await (await request.get(fullUrl!)).body();
  const thumb = await (await request.get(thumbUrl)).body();
  expect(thumb.byteLength).toBeLessThan(full.byteLength);
});
