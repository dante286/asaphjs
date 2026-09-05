import { spawn } from "node:child_process";
import { cp, mkdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { config } from "dotenv";

/**
 * Serves the standalone build for a local `npm run test:e2e`, the same way the
 * container does — which is the whole reason this exists rather than
 * `next start`.
 *
 * `next start` serves out of the full `node_modules`, where libvips is present
 * whatever the build's tracer decided, so a photo upload works there even when
 * the deployed image would throw ERR_DLOPEN_FAILED (see the comment on
 * `outputFileTracingIncludes` in next.config.ts). Only the standalone output —
 * or an image built from it — can fail the way production fails.
 *
 * CI skips this entirely: it sets E2E_BASE_URL at the running container, and
 * playwright.config.ts drops its `webServer` when that variable is set.
 */

const root = process.cwd();
const built = path.join(root, ".next", "standalone");

/**
 * The output is copied out of the tree before being run, and this is the point
 * of the whole script rather than a tidiness measure.
 *
 * `.next/standalone` lives *inside* the project, so Node resolving a bare
 * `require("sharp")` from `.next/standalone/server.js` walks up past the traced
 * `node_modules` into the repo's real one and finds the full install — libvips
 * included. Running it in place therefore passes for exactly the reason
 * `next start` passes, one directory deeper: a missing trace is silently
 * covered by the dependencies sitting above it. Verified by deleting the
 * `outputFileTracingIncludes` block and watching the photo spec stay green.
 *
 * Somewhere under the OS temp directory there is nothing above to fall back to,
 * so an incomplete trace fails here the way it fails in the image.
 *
 * `dereference` is what makes the copy self-contained, and it took a while to
 * find. Turbopack leaves relative symlinks in `.next/node_modules`
 * (`sharp-<hash>` -> `../../node_modules/sharp`), which Docker's COPY preserves
 * as relative and which therefore keep resolving inside `/app`. Node's `fs.cp`
 * instead rewrites them to absolute targets in the *source* tree — so a copied
 * tree still pointed at the repo, walked up to the developer's real
 * `node_modules`, and found the libvips the trace had left behind. Following the
 * links while copying is what closes that door.
 */
const staged = path.join(os.tmpdir(), "asaphjs-e2e-standalone");

// Same file drizzle.config.ts and the seed script read. dotenv doesn't overwrite
// an already-set variable, so an exported DATABASE_URL still wins.
config({ path: ".env.local" });

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

if (!(await exists(path.join(built, "server.js")))) {
  console.error(
    "No .next/standalone/server.js — run `npm run build` first.\n" +
      "This deliberately doesn't build for you: a build hidden inside a test run is " +
      "a three-minute pause with no output, and a stale one is worse than an error.",
  );
  process.exit(1);
}

// Cleared rather than copied over. A leftover `@img` from a previous build is
// precisely the stale state that would make the photo spec pass on a trace that
// no longer contains it.
await rm(staged, { recursive: true, force: true });
await cp(built, staged, { recursive: true, dereference: true });

// `output: "standalone"` traces only what the server imports, so the static
// assets and public/ have to be placed beside it — the same two COPY lines the
// Dockerfile's runner stage has, for the same reason.
await cp(path.join(root, ".next", "static"), path.join(staged, ".next", "static"), {
  recursive: true,
  dereference: true,
});
await cp(path.join(root, "public"), path.join(staged, "public"), {
  recursive: true,
  dereference: true,
});

const uploads = path.join(staged, "uploads");
await mkdir(uploads, { recursive: true });

const child = spawn(process.execPath, ["server.js"], {
  cwd: staged,
  stdio: "inherit",
  env: {
    ...process.env,
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    PORT: process.env.PORT ?? "3000",
    // Pinned, not inherited: Next's standalone server binds to `HOSTNAME`, and
    // a login shell usually exports that as the machine's own name — which would
    // bind somewhere the config's baseURL isn't looking.
    HOSTNAME: "127.0.0.1",
    // Beside the staged copy, so a run leaves nothing behind in the developer's
    // own ./uploads and starts from an empty directory every time.
    UPLOADS_DIR: uploads,
    // The suite signs up its own throwaway account per spec, so a developer who
    // has closed registration on their instance can still run it.
    ALLOW_SIGNUPS: "true",
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? "e2e-secret-not-for-anything-real",
    // Blanked rather than inherited, and this is not a detail: with real keys in
    // .env.local the lookup panel appears, `lookup-degrades.spec.ts` fails, and
    // every run starts spending someone's provider quota. The container CI runs
    // against has no credentials either, so this is also what keeps the two
    // environments the same. Open Library needs no key and is always
    // configured — no spec may use a template that resolves to it.
    IGDB_CLIENT_ID: "",
    IGDB_CLIENT_SECRET: "",
    TMDB_API_KEY: "",
  },
});

child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
