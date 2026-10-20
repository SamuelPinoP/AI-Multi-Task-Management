// Runs prisma migrate deploy on Vercel builds that own their database: production,
// and previews once PREVIEW_DATABASE_URL points them at the separate preview database.
// Without it a preview would share production's database, so it must not migrate.
import { spawnSync } from "node:child_process";

const vercelEnv = process.env.VERCEL_ENV;
const hasPreviewDatabase = vercelEnv === "preview" && Boolean(process.env.PREVIEW_DATABASE_URL?.trim());

if (vercelEnv !== "production" && !hasPreviewDatabase) {
  console.log(`Skipping prisma migrate deploy (VERCEL_ENV=${vercelEnv ?? "unset"}, no separate preview database).`);
  process.exit(0);
}

console.log(`Running prisma migrate deploy against the ${hasPreviewDatabase ? "preview" : "production"} database.`);
const result = spawnSync("npx", ["prisma", "migrate", "deploy"], {
  stdio: "inherit",
  shell: process.platform === "win32",
});
if (result.error) console.error(result.error);
process.exit(result.status ?? 1);
