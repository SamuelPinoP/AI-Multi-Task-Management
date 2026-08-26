import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = new URL(
  "../../prisma/migrations/20260814000000_add_attachment_storage_provider/migration.sql",
  import.meta.url,
);

test("legacy migration identifies only historical local and Vercel metadata", async () => {
  const migration = await readFile(migrationPath, "utf8");
  assert.match(migration, /LIKE '\/uploads\/project-chat\/%'[\s\S]*'LOCAL'/);
  assert.match(migration, /\^https\?:\/\/'[\s\S]*'VERCEL_BLOB'/);
  assert.doesNotMatch(migration, /SET[\s\S]*'AWS_S3'::/);
  assert.match(migration, /RAISE EXCEPTION 'Cannot infer attachment storage provider/);
  assert.match(migration, /ALTER COLUMN "storageProvider" SET NOT NULL/);
  assert.match(migration, /ALTER COLUMN "storageKey" SET NOT NULL/);
});
