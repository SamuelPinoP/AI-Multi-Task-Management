// Pure parts of the database backup: file format, naming, retention and the
// order tables are restored in. No server-only imports, so they're unit tested.

export const BACKUP_FORMAT = "ai-multi-database-backup";
export const BACKUP_VERSION = 1;
export const BACKUP_PREFIX = "backups/database/";
export const BACKUP_RETENTION = 30;
export const BACKUP_MIN_INTERVAL_MS = 20 * 60 * 60 * 1000;

/**
 * Tables left out of backups: Prisma's own migration log (restores start from
 * `prisma migrate deploy`), and short-lived secrets that are useless after a
 * restore (login sessions, password reset tokens, pending upload slots).
 */
export const BACKUP_EXCLUDED_TABLES = new Set([
  "_prisma_migrations",
  "Session",
  "PasswordResetToken",
  "ProjectChatAttachmentUpload",
]);

export type DatabaseBackup = {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  createdAt: string;
  migrations: string[];
  tables: Record<string, Record<string, unknown>[]>;
};

export type ForeignKeyEdge = { child: string; parent: string };

export function isSafeTableName(name: string) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

/** Double-quoted identifier for a table name read from the catalog. */
export function quoteTable(name: string) {
  if (!isSafeTableName(name)) throw new Error(`Unexpected table name: ${name}`);
  return `"${name}"`;
}

export function backupKey(date: Date) {
  return `${BACKUP_PREFIX}${date.toISOString().replace(/[:.]/g, "-")}.json.gz`;
}

/** Keys are timestamped, so the newest sort last; everything past `keep` goes. */
export function backupKeysToDelete(keys: string[], keep = BACKUP_RETENTION) {
  return [...keys].sort().reverse().slice(keep);
}

/** A backup made less than 20 hours ago means today's is already done. */
export function isRecentBackup(latest: Date | undefined, now: Date) {
  return Boolean(latest && now.getTime() - latest.getTime() < BACKUP_MIN_INTERVAL_MS);
}

/**
 * Orders tables so every table comes after the tables it references, so rows
 * can be inserted without breaking foreign keys. Self-references are fine:
 * one INSERT holds all of a table's rows, and Postgres checks foreign keys at
 * the end of the statement.
 */
export function orderTablesForRestore(tables: string[], edges: ForeignKeyEdge[]) {
  const included = new Set(tables);
  const parents = new Map(tables.map((table) => [table, new Set<string>()]));
  for (const { child, parent } of edges) {
    if (child !== parent && included.has(child) && included.has(parent)) parents.get(child)!.add(parent);
  }

  const ordered: string[] = [];
  const remaining = new Set([...tables].sort());
  while (remaining.size > 0) {
    const ready = [...remaining].filter((table) => [...parents.get(table)!].every((parent) => !remaining.has(parent)));
    if (ready.length === 0) throw new Error(`Foreign keys form a cycle between: ${[...remaining].join(", ")}`);
    for (const table of ready) {
      ordered.push(table);
      remaining.delete(table);
    }
  }
  return ordered;
}

/** Checks a parsed backup file's shape before anything is restored from it. */
export function parseBackup(value: unknown): DatabaseBackup {
  const backup = value as Partial<DatabaseBackup> | null;
  if (!backup || backup.format !== BACKUP_FORMAT) throw new Error("This file is not an AI Multi database backup.");
  if (backup.version !== BACKUP_VERSION) throw new Error(`Unsupported backup version ${String(backup.version)}.`);
  if (typeof backup.createdAt !== "string" || !Array.isArray(backup.migrations)) throw new Error("The backup is missing its header.");
  if (!backup.tables || typeof backup.tables !== "object") throw new Error("The backup has no tables.");
  for (const [name, rows] of Object.entries(backup.tables)) {
    if (!isSafeTableName(name) || !Array.isArray(rows)) throw new Error(`The backup's table ${name} is malformed.`);
  }
  return backup as DatabaseBackup;
}
