import { defineConfig } from "vitest/config";

/**
 * Three tiers. `unit` and `providers` need nothing set up — no database, no
 * network, no credentials — and are what `npm test` runs. `db` needs a Postgres
 * server and is `npm run test:db`, which is why that one is named explicitly
 * rather than excluded: a tier that needs infrastructure has to opt *in*, or
 * the promise that `npm test` works from a clean checkout lasts exactly until
 * someone adds a tier.
 *
 * The split is by setup, not by speed. The `providers` tier loads setup files
 * that scrub provider credentials out of `process.env`, replace the rate
 * limiter and stand MSW up; the `db` tier points `DATABASE_URL` at a database
 * of its own. None of that may leak into the unit tier, whose whole claim is
 * that it runs a plain module with nothing around it.
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
            // The integration tier's, for the same reason. A directory won't do
            // here: db/queries holds both kinds, because most of those modules
            // have a pure function worth testing with nothing running (see
            // items.test.ts beside items.db.test.ts) as well as SQL that only
            // means anything against Postgres.
            "src/**/*.db.test.ts",
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
      {
        extends: true,
        test: {
          name: "db",
          environment: "node",
          include: ["src/**/*.db.test.ts"],
          /**
           * Once per run: drop leftovers, create one database, migrate it, seed
           * the system templates. Every worker then clones it, which on
           * Postgres is a filesystem copy — see the file for why a template
           * database rather than a transaction per test.
           */
          globalSetup: ["./src/test/db/global-setup.ts"],
          /**
           * Per file, and before the spec is imported: db/client.ts captures
           * DATABASE_URL at module evaluation, so pointing it at this worker's
           * own database has to happen first. Also truncates between tests.
           */
          setupFiles: ["./src/test/db/setup.ts"],
          /**
           * Migrating and cloning happen before any of this, but a cold
           * Postgres container can still make the first query in a file slower
           * than the 5s default — and a timeout there reads as a broken spec
           * rather than a slow server.
           */
          testTimeout: 20_000,
          hookTimeout: 30_000,
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
       *
       * `npm run test:coverage` runs all three tiers, the `db` one included, so
       * it needs `docker compose up -d db`. The alternative — measuring the two
       * hermetic tiers only — would report the query layer as barely covered
       * when it is the thing this list was extended for.
       */
      include: [
        // The route handlers and actions the integration tier calls directly.
        // `api/auth/[...all]` is Better Auth's own handler and is deliberately
        // absent: testing it here would be testing the library.
        "src/app/api/account/export/*/route.ts",
        "src/app/api/collections/**/route.ts",
        "src/app/api/lookup/**/route.ts",
        "src/app/api/uploads/**/route.ts",
        "src/actions/collections.ts",
        "src/actions/imports.ts",
        "src/actions/members.ts",
        "src/actions/metadata.ts",
        "src/actions/account.ts",
        "src/lib/auth/api-guard.ts",
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
        "src/db/queries/collections.ts",
        "src/db/queries/items.ts",
        "src/db/queries/members.ts",
        "src/db/queries/imports.ts",
        "src/db/queries/metadata.ts",
        "src/db/queries/stats.ts",
        "src/db/queries/templates.ts",
        "src/db/queries/view-preferences.ts",
      ],
    },
  },
});
