import { config } from "dotenv";

// Load env here rather than via a `DOTENV_CONFIG_PATH=... -r dotenv/config`
// prefix on the npm script — that syntax is POSIX-only and breaks under
// cmd.exe/PowerShell. Same file drizzle.config.ts reads.
config({ path: ".env.local" });

async function main() {
  // Imported dynamically: db/client.ts reads DATABASE_URL at module-eval
  // time, and static imports would hoist above the config() call above.
  const { seedTemplates } = await import("./templates");
  await seedTemplates();

  if (process.argv.includes("--demo")) {
    const { seedDemo } = await import("./demo");
    await seedDemo();
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
