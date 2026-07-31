import { seedTemplates } from "./templates";

async function main() {
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
