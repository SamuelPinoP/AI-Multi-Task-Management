import "server-only";
import { gzipSync } from "node:zlib";
import { mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { DeleteObjectCommand, ListObjectsV2Command, PutObjectCommand } from "@aws-sdk/client-s3";
import { prisma } from "@/lib/prisma";
import { projectChatS3Target } from "@/lib/project-chat-storage";
import {
  BACKUP_EXCLUDED_TABLES,
  BACKUP_FORMAT,
  BACKUP_PREFIX,
  BACKUP_VERSION,
  backupKey,
  backupKeysToDelete,
  isRecentBackup,
  quoteTable,
} from "@/lib/database-backup-core";

type StoredBackup = { key: string; lastModified: Date };

type BackupStore = {
  location: string;
  list(): Promise<StoredBackup[]>;
  put(key: string, body: Buffer): Promise<void>;
  remove(key: string): Promise<void>;
};

/** Production: the private R2 bucket. Local development: ./backups. Elsewhere: none. */
function backupStore(): BackupStore | null {
  const target = projectChatS3Target();
  if (target) {
    const { bucket, client } = target;
    return {
      location: "R2",
      async list() {
        const found: StoredBackup[] = [];
        let token: string | undefined;
        do {
          const page = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: BACKUP_PREFIX, ContinuationToken: token }));
          for (const item of page.Contents ?? []) {
            if (item.Key && item.LastModified) found.push({ key: item.Key, lastModified: item.LastModified });
          }
          token = page.IsTruncated ? page.NextContinuationToken : undefined;
        } while (token);
        return found;
      },
      async put(key, body) {
        await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: "application/gzip" }));
      },
      async remove(key) {
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      },
    };
  }

  // Never write to the read-only filesystem of a Vercel deployment.
  if (process.env.VERCEL) return null;

  // Keys start with "backups/database/", so they map onto ./backups/database.
  const root = process.cwd();
  return {
    location: "./backups",
    async list() {
      const dir = path.join(root, BACKUP_PREFIX);
      const names = await readdir(dir).catch(() => [] as string[]);
      return Promise.all(
        names.map(async (name) => ({ key: `${BACKUP_PREFIX}${name}`, lastModified: (await stat(path.join(dir, name))).mtime })),
      );
    },
    async put(key, body) {
      await mkdir(path.dirname(path.join(root, key)), { recursive: true });
      await writeFile(path.join(root, key), body);
    },
    async remove(key) {
      await unlink(path.join(root, key));
    },
  };
}

/** Exports every table except the excluded ones as one gzipped JSON document. */
export async function createDatabaseBackup(now = new Date()) {
  const tables = await prisma.$queryRawUnsafe<{ table_name: string }[]>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE' ORDER BY table_name",
  );
  const migrations = await prisma.$queryRawUnsafe<{ migration_name: string }[]>(
    "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name",
  );

  const counts: Record<string, number> = {};
  const parts: string[] = [];
  for (const { table_name: table } of tables) {
    if (BACKUP_EXCLUDED_TABLES.has(table)) continue;
    // Postgres writes the JSON, so dates, enums and nulls round-trip exactly.
    const [result] = await prisma.$queryRawUnsafe<{ count: number; rows: string }[]>(
      `SELECT count(*)::int AS count, coalesce(json_agg(t), '[]'::json)::text AS rows FROM ${quoteTable(table)} t`,
    );
    counts[table] = result.count;
    parts.push(`${JSON.stringify(table)}:${result.rows}`);
  }

  const header = JSON.stringify({
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: now.toISOString(),
    migrations: migrations.map((row) => row.migration_name),
  });
  const document = `${header.slice(0, -1)},"tables":{${parts.join(",")}}}`;
  return { body: gzipSync(document), counts };
}

export type ScheduledBackupResult =
  | { status: "skipped"; reason: string }
  | { status: "created"; key: string; location: string; bytes: number; counts: Record<string, number>; deleted: number };

/**
 * Makes today's backup unless one already exists from the last 20 hours, then
 * keeps only the newest 30. Safe to call repeatedly.
 */
export async function runScheduledBackup(now = new Date()): Promise<ScheduledBackupResult> {
  const store = backupStore();
  if (!store) return { status: "skipped", reason: "No backup storage is configured for this deployment." };

  const existing = await store.list();
  const latest = existing.reduce<Date | undefined>(
    (newest, item) => (!newest || item.lastModified > newest ? item.lastModified : newest),
    undefined,
  );
  if (isRecentBackup(latest, now)) return { status: "skipped", reason: `A backup from ${latest!.toISOString()} already exists.` };

  const { body, counts } = await createDatabaseBackup(now);
  const key = backupKey(now);
  await store.put(key, body);

  const toDelete = backupKeysToDelete([...existing.map((item) => item.key), key]);
  for (const oldKey of toDelete) await store.remove(oldKey);

  return { status: "created", key, location: store.location, bytes: body.length, counts, deleted: toDelete.length };
}
