# Item photos

Covers come from a metadata provider when one has art (copied into this same store — see
[Cover art is copied, not hotlinked](metadata.md#cover-art-is-copied-not-hotlinked)), and otherwise from a photo the owner uploads on the item detail page
(JPEG/PNG/WebP/GIF/AVIF, 10MB cap). Files land in
`UPLOADS_DIR` (default `./uploads`, a Docker volume in Compose) — no S3/R2 wiring.

Nothing is stored as sent. `src/lib/uploads/store.ts` re-encodes every upload through
sharp: EXIF orientation applied, then bounded to 1600px on the longest edge and written
as WebP. That caps what a 4000px phone photo costs to serve, drops the EXIF block (a
camera roll photo carries GPS coordinates), and means the bytes on disk are libvips
output rather than a stranger's file. Animated GIFs keep their first frame only.

Each upload also gets a 500px thumbnail at `<id>_t.webp`, which is what the covers grid
and the public share page load — a 60-tile grid of phone photos costs ~1.5MB instead of
~24MB. Only the full-size URL is stored on the item; `thumbUrlFor()` in
`src/lib/uploads/urls.ts` derives the thumb name, so there's no schema change and
provider cover URLs pass through untouched. Uploads written before thumbnails existed
have no `_t` file, and the read route falls back to the full-size image for them rather
than 404ing a tile.

Files are removed with the rows that referenced them: deleting an item, deleting a
collection (whose items go by `on delete cascade`, so their covers are read before the rows
disappear), deleting an account (the same cascade one level up — see
[Deleting an account sweeps its uploads first](accounts.md#deleting-an-account-sweeps-its-uploads-first)), and rolling
back an import batch all sweep up after themselves. That cleanup
lives in `src/db/queries/*` rather than in the routes, so a future caller of `deleteItem`
can't forget it, and in `src/lib/uploads/files.ts` rather than `store.ts` so unlinking a
file doesn't drag sharp into that route's standalone trace.

Four things worth knowing about that path:

- Uploads are **not** under `public/`. Next indexes the public folder once at server
  start in production, so anything written afterwards 404s until a restart. They're
  served by `src/app/api/uploads/[name]/route.ts` instead, which reads per request.
- That read route is **unauthenticated by design** — public share pages (`/s/:token`)
  render covers with plain `<img>` and carry no session. The random filename is the
  capability, so anyone holding the URL can fetch the photo. Fine for shelf pictures;
  swap in signed URLs before storing anything sensitive.
- Reads and writes against that directory are marked `/*turbopackIgnore: true*/`.
  `UPLOADS_DIR` points at a mounted volume, so the paths only exist at runtime and the
  build tracer can't statically scope them. Left alone it assumes the worst and traces the
  whole project into `.next/standalone` — `src/`, `README.md`, `scripts/`, `drizzle/`, and
  the developer's own local `uploads/` all ride along into the deploy image. The annotation
  is what makes the Dockerfile's claim of tracing "only the files next start actually
  needs" true.
- sharp ships prebuilt platform binaries, so the Docker image needs the `linuxmusl`
  ones from `package-lock.json` — regenerate the lockfile with `npm install`, never by
  hand-editing, or `npm ci` inside `node:24-alpine` won't find them.
