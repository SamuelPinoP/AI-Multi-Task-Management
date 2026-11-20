// Runs prisma migrate deploy on Vercel builds that own their database: production,
// and previews once PREVIEW_DATABASE_URL points them at the separate preview database.
// Without it a preview would share production's database, so it must not migrate.
//
// A deploy that brings no new migration skips the step, so the build doesn't wake the
// database (CU-04, #510): R2 remembers which migrations the last successful run applied
// to it. The reasons, and when it runs anyway, are in src/lib/deploy-migrations-core.ts.
// Run by `vercel-build` (package.json) with --conditions react-server, like the restore
// script, because the R2 settings come from the app's storage module.
import { spawnSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { resolveDatabaseUrl, resolveMigrationDatabaseUrl } from "../src/lib/database-url";
import { runDeployMigrations, type DeployRecordStore, type MigrationFile } from "../src/lib/deploy-migrations-core";
import { projectChatS3Target } from "../src/lib/project-chat-storage";

const MIGRATIONS_DIR = path.join(process.cwd(), "prisma", "migrations");

/** Every migration folder Prisma would apply, with its SQL. */
async function readMigrations(): Promise<MigrationFile[]> {
  const entries = await readdir(MIGRATIONS_DIR, { withFileTypes: true });
  const migrations: MigrationFile[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const sql = await readFile(path.join(MIGRATIONS_DIR, entry.name, "migration.sql"), "utf8").catch((error: NodeJS.ErrnoException) => {
      // Prisma skips folders without a migration.sql too.
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (sql !== null) migrations.push({ name: entry.name, sql });
  }
  return migrations;
}

/** The private R2 bucket the app already uses for backups and calendar feeds, or null without one. */
function openStore(): DeployRecordStore | null {
  const target = projectChatS3Target();
  if (!target) return null;
  const { bucket, client } = target;
  return {
    async get(key) {
      try {
        const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        return (await object.Body?.transformToString("utf-8")) ?? null;
      } catch (error) {
        const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
        if ((error instanceof Error && error.name === "NoSuchKey") || status === 404) return null;
        throw error;
      }
    },
    async put(key, body) {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: "application/json" }));
    },
  };
}

async function migrate() {
  // prisma.config.ts migrates over resolveMigrationDatabaseUrl(); say so when that isn't the app's pooled URL.
  if (resolveMigrationDatabaseUrl() !== resolveDatabaseUrl()) {
    console.log("prisma migrate deploy connects to Neon directly, not through the pooler, so its lock ends with this build (#515).");
  }
  const result = spawnSync("npx", ["prisma", "migrate", "deploy"], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) console.error(result.error);
  return result.status === 0;
}

async function main() {
  const result = await runDeployMigrations({
    env: process.env,
    databaseUrl: resolveMigrationDatabaseUrl(),
    readMigrations,
    openStore,
    migrate,
    log: (message) => console.log(message),
    now: () => new Date(),
  });
  process.exit(result.status === "failed" ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
