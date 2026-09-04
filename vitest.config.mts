import { defineConfig } from "vitest/config";

/**
 * Two tiers, with a third (`db`, needing Postgres) still to come. Both of these
 * need nothing set up — no database, no network, no credentials — so `vitest
 * run` runs them together and CI needs no services for either.
 *
 * The split is by setup, not by speed: the `providers` tier loads setup files
 * that scrub provider credentials out of `process.env`, replace the rate
 * limiter and stand MSW up. None of that may leak into the unit tier, whose
 * whole claim is that it runs a plain module with nothing around it.
 *
 * `resolve.tsconfigPaths` resolves `@/*` by reading tsconfig.json, so the alias
 * can't drift from the one Next uses. The bundled Next guide reaches for the
 * `vite-tsconfig-paths` plugin here, but the Vite 8 that ships inside Vitest
 * does this natively and warns that the plugin is now redundant — same source
 * of truth, one less devDependency.
 *
 * Vitest 4 rather than 5: better-auth declares an optional peer on
 * `vitest@^2 || ^3 || ^4`, and installing 5 leaves the tree in a state where
 * every subsequent `npm install` fails ERESOLVE until better-auth widens it.
 * The 4.x line needs no `--legacy-peer-deps` and resolves the same Vite 8.
 */
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    projects: [
      {
        // Not a default in 4.x, and the resolve option above only reaches this
        // project through it — without this, `@/*` imports fail to resolve.
        extends: true,
        test: {
          name: "unit",
          // No jsdom. Every page under src/app/(app) is an async Server
          // Component, which Vitest can't render (see the bundled guide at
          // node_modules/next/dist/docs/01-app/02-guides/testing/vitest.md), so
          // a DOM would buy a slower run and nothing else. Components are the
          // E2E suite's job.
          environment: "node",
          include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
          exclude: [
            // Tests are colocated, but never under src/app: the App Router
            // matches route.ts and page.tsx by convention, and a sibling
            // *.test.ts there is one rename away from being treated as a route.
            "src/app/**",
            // The providers tier's files, which this tier's `src/**` would
            // otherwise also collect — and then run without any of the setup
            // they need. One directory rather than a filename convention, so a
            // new provider's spec joins the right tier by living next to its
            // subject.
            "src/lib/metadata/providers/**",
          ],
        },
      },
      {
        extends: true,
        test: {
          name: "providers",
          environment: "node",
          include: ["src/lib/metadata/providers/**/*.test.ts"],
          /**
           * A setup file rather than per-spec hooks, because the ordering is
           * the point: providers read `process.env` and build their rate
           * limiter at module evaluation, so the credential scrub and the
           * limiter mock have to land before the spec that imports them is
           * loaded. Setup files run first, which is what buys that.
           */
          setupFiles: ["./src/test/providers/setup.ts"],
        },
      },
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      /**
       * An allowlist, not the whole tree. Coverage over `src/**` would report a
       * number dominated by React components and route handlers these tiers
       * deliberately don't test, which makes the figure useless for the one
       * thing it's for — seeing whether the modules they do test are covered.
       *
       * No thresholds. A number nobody has measured is a guess, not a standard;
       * they land once there's data to set them from.
       */
      include: [
        "src/lib/metadata/prefill.ts",
        "src/lib/metadata/cover-mirror.ts",
        "src/lib/metadata/lookup-config.ts",
        "src/lib/metadata/cached-provider.ts",
        "src/lib/metadata/rate-limiter.ts",
        "src/lib/metadata/providers/igdb.ts",
        "src/lib/metadata/providers/tmdb.ts",
        "src/lib/metadata/providers/openlibrary.ts",
        "src/lib/fields/type-guess.ts",
        "src/lib/fields/field-def.ts",
        "src/lib/fields/item-values.ts",
        "src/lib/uploads/urls.ts",
        "src/lib/uploads/store.ts",
        "src/lib/csv/parse.ts",
        "src/lib/auth/signups.ts",
        "src/lib/format.ts",
        "src/db/queries/items.ts",
        "src/db/queries/stats.ts",
        "src/db/queries/templates.ts",
      ],
    },
  },
});
