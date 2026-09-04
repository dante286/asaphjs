import { defineConfig } from "vitest/config";

/**
 * Structured as a `projects` array with one project defined, because the plan
 * is for more than one: a `providers` tier that fakes provider HTTP and a `db`
 * tier that needs Postgres. Those need setup files and environments this tier
 * must not inherit, and adding the split later means moving every option down a
 * level. Leaving room for it costs one nesting level now.
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
          // Tests are colocated, but never under src/app: the App Router
          // matches route.ts and page.tsx by convention, and a sibling
          // *.test.ts there is one rename away from being treated as a route.
          exclude: ["src/app/**"],
        },
      },
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      /**
       * An allowlist, not the whole tree. Coverage over `src/**` would report a
       * number dominated by React components and route handlers this tier
       * deliberately doesn't test, which makes the figure useless for the one
       * thing it's for — seeing whether the pure-logic modules are covered.
       *
       * No thresholds. A number nobody has measured is a guess, not a standard;
       * they land once there's data to set them from.
       */
      include: [
        "src/lib/metadata/prefill.ts",
        "src/lib/metadata/cover-mirror.ts",
        "src/lib/metadata/lookup-config.ts",
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
