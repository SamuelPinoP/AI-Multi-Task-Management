// Restores an AI Multi database backup into an EMPTY database.
//
//   1. Create an empty database (for example a new Neon branch or database).
//   2. Give it the schema:     DATABASE_URL="<target>" npx prisma migrate deploy
//   3. Restore into it:        RESTORE_DATABASE_URL="<target>" npm run restore:database -- <file.json.gz>
//      or straight from R2:    DOTENV_CONFIG_PATH=.env.r2 RESTORE_DATABASE_URL="<target>" npm run restore:database -- --from-r2 latest
//
// It refuses to write into a database that already has rows, and stops if the
// backup was made with migrations the target doesn't have (--force-schema skips
// that check). Login sessions aren't in backups, so everyone logs in again.
import "dotenv/config";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { Pool } from "pg";
import { BACKUP_PREFIX, orderTablesForRestore, parseBackup, quoteTable } from "../src/lib/database-backup-core";
import { projectChatS3Target } from "../src/lib/project-chat-storage";

async function readBackupBytes(args: string[]) {
  const fromR2 = args.indexOf("--from-r2");
  if (fromR2 === -1) {
    const file = args.find((arg) => !arg.startsWith("--"));
    if (!file) throw new Error("Pass a backup file, or --from-r2 latest (or a backup key).");
    return { source: file, bytes: readFileSync(file) };
  }

  const target = projectChatS3Target();
  if (!target) throw new Error("--from-r2 needs the R2 settings (AWS_S3_BUCKET_NAME, AWS_REGION, AWS_S3_ENDPOINT and keys), e.g. DOTENV_CONFIG_PATH=.env.r2.");
  let key = args[fromR2 + 1];
  if (!key || key === "latest") {
    const listed = await target.client.send(new ListObjectsV2Command({ Bucket: target.bucket, Prefix: BACKUP_PREFIX }));
    key = (listed.Contents ?? []).map((item) => item.Key ?? "").filter(Boolean).sort().at(-1) ?? "";
    if (!key) throw new Error("No backups found in R2.");
  }
  const object = await target.client.send(new GetObjectCommand({ Bucket: target.bucket, Key: key }));
  return { source: `R2 ${key}`, bytes: Buffer.from(await object.Body!.transformToByteArray()) };
}

async function main() {
  const args = process.argv.slice(2);
  const connectionString = process.env.RESTORE_DATABASE_URL?.trim();
  if (!connectionString) throw new Error("Set RESTORE_DATABASE_URL to the empty database to restore into.");

  const { source, bytes } = await readBackupBytes(args);
  const backup = parseBackup(JSON.parse(gunzipSync(bytes).toString("utf8")));
  console.log(`Backup from ${backup.createdAt} (${source}).`);

  const pool = new Pool({ connectionString });
  const client = await pool.connect();
  try {
    const applied = await client
      .query<{ migration_name: string }>("SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL")
      .catch(() => {
        throw new Error("The target has no schema. Run `npx prisma migrate deploy` against it first.");
      });
    const appliedNames = new Set(applied.rows.map((row) => row.migration_name));
    const missing = backup.migrations.filter((name) => !appliedNames.has(name));
    if (missing.length > 0 && !args.includes("--force-schema")) {
      throw new Error(`The target lacks migrations the backup was made with: ${missing.join(", ")}. Deploy them first, or pass --force-schema.`);
    }

    const existingTables = new Set(
      (await client.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'")).rows.map(
        (row) => row.table_name,
      ),
    );
    const tables = Object.keys(backup.tables);
    const absent = tables.filter((table) => !existingTables.has(table));
    if (absent.length > 0) throw new Error(`The target has no table for: ${absent.join(", ")}.`);

    for (const table of tables) {
      const { rows } = await client.query(`SELECT EXISTS (SELECT 1 FROM ${quoteTable(table)}) AS has_rows`);
      if (rows[0].has_rows) throw new Error(`The target isn't empty (${table} has rows). Restore only into an empty database.`);
    }

    const edges = (
      await client.query<{ child: string; parent: string }>(
        `SELECT c.conrelid::regclass::text AS child, c.confrelid::regclass::text AS parent
           FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
          WHERE c.contype = 'f' AND n.nspname = current_schema()`,
      )
    ).rows.map((edge) => ({ child: edge.child.replace(/"/g, ""), parent: edge.parent.replace(/"/g, "") }));

    await client.query("BEGIN");
    for (const table of orderTablesForRestore(tables, edges)) {
      const rows = backup.tables[table];
      if (rows.length === 0) continue;
      // Postgres converts the JSON back to each column's type (dates, enums, ...).
      await client.query(`INSERT INTO ${quoteTable(table)} SELECT * FROM json_populate_recordset(NULL::${quoteTable(table)}, $1::json)`, [JSON.stringify(rows)]);
      console.log(`  ${table}: ${rows.length} rows`);
    }
    await client.query("COMMIT");
    console.log("Restore complete. Everyone needs to log in again (sessions aren't backed up).");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
