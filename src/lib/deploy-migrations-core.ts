import { createHash } from "node:crypto";

// CU-04 (#510): a deploy that brings no new migration shouldn't wake the database.
//
// `prisma migrate deploy` connects even when there's nothing to apply, and a connection
// keeps Neon's compute awake for at least 5 minutes. So after each successful run the
// build remembers in R2 which migrations it applied to which database, and the next build
// skips the step when it carries exactly those migrations. The record only ever claims
// what a successful run proved, so a build is skipped only when every migration it
// carries is already in that database. Kept free of R2, Prisma and process globals so it
// can be unit tested; scripts/migrate-deployment-database.ts wires it up.

export const DEPLOY_RECORD_PREFIX = "deploy-migrations/";

/** One migration folder in prisma/migrations: its name and its migration.sql. */
export type MigrationFile = { name: string; sql: string };

/** What a successful `prisma migrate deploy` applied, stored as JSON in R2. Never the database URL. */
export type DeployRecord = {
  version: 1;
  /** migrationsDigest() of the migrations the run applied. */
  digest: string;
  /** How many migrations that was, for the build log. */
  migrations: number;
  /** The commit that was deployed (VERCEL_GIT_COMMIT_SHA), when Vercel says. */
  commit: string | null;
  /** When the run finished, as an ISO date. */
  appliedAt: string;
};

/** Where the records live: R2 in production; stand-ins in tests. */
export type DeployRecordStore = {
  /** The stored text, or null when there's none. */
  get(key: string): Promise<string | null>;
  put(key: string, body: string): Promise<void>;
};

/**
 * One SHA-256 over every migration's folder name and SQL, in name order (Prisma's order),
 * so adding, removing, renaming or editing any migration changes it.
 */
export function migrationsDigest(migrations: MigrationFile[]) {
  const hash = createHash("sha256");
  for (const migration of [...migrations].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    hash.update(`${migration.name}\0${migration.sql}\0`);
  }
  return hash.digest("hex");
}

/**
 * Which database a URL points at, as a SHA-256 of its user, host, port, database and
 * schema, so the bucket never holds the URL or the password, and a different database
 * (a restore into a new Neon branch, or the preview database) never matches. The schema
 * counts because Prisma keeps its list of applied migrations in it. Null when the URL
 * can't be read; Prisma then reports the problem itself.
 */
export function databaseFingerprint(databaseUrl: string | undefined) {
  if (!databaseUrl) return null;
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    return null;
  }
  if (!/^postgres(ql)?:$/.test(url.protocol) || !url.hostname) return null;
  const user = decodeURIComponent(url.username);
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  const schema = url.searchParams.get("schema") || "public";
  const target = `${user}@${url.hostname.toLowerCase()}:${url.port || "5432"}/${database}?schema=${schema}`;
  return createHash("sha256").update(target).digest("hex");
}

export function deployRecordKey(fingerprint: string) {
  return `${DEPLOY_RECORD_PREFIX}${fingerprint}.json`;
}

/** A stored record, or null for anything else: none, unreadable JSON, or a shape this code doesn't know. */
export function parseDeployRecord(text: string | null): DeployRecord | null {
  if (!text) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.version !== 1) return null;
  if (typeof record.digest !== "string" || !/^[0-9a-f]{64}$/.test(record.digest)) return null;
  if (typeof record.migrations !== "number" || !Number.isInteger(record.migrations) || record.migrations < 0) return null;
  if (record.commit !== null && typeof record.commit !== "string") return null;
  if (typeof record.appliedAt !== "string" || Number.isNaN(Date.parse(record.appliedAt))) return null;
  return {
    version: 1,
    digest: record.digest,
    migrations: record.migrations,
    commit: record.commit,
    appliedAt: record.appliedAt,
  };
}

/** `ALWAYS_RUN_MIGRATIONS=true` runs `prisma migrate deploy` on every deploy, for after an in-place restore. */
export function alwaysRunMigrations(env: Record<string, string | undefined>) {
  return env.ALWAYS_RUN_MIGRATIONS?.trim() === "true";
}

/** Which database this build migrates, if any: production, or a preview that has its own (#166). */
export function deployTarget(env: Record<string, string | undefined>): "production" | "preview" | null {
  if (env.VERCEL_ENV === "production") return "production";
  if (env.VERCEL_ENV === "preview" && env.PREVIEW_DATABASE_URL?.trim()) return "preview";
  return null;
}

function describeDeploy(record: DeployRecord) {
  const when = `${record.appliedAt.slice(0, 16).replace("T", " ")} UTC`;
  return record.commit ? `the deploy of ${record.commit.slice(0, 7)} on ${when}` : `a deploy on ${when}`;
}

function errorName(error: unknown) {
  return error instanceof Error ? error.name : "UnknownError";
}

export type DeployMigrationsInput = {
  env: Record<string, string | undefined>;
  /** The URL Prisma migrates (resolveMigrationDatabaseUrl in src/lib/database-url.ts). */
  databaseUrl: string | undefined;
  /** Which address that is, for the build log (describeMigrationConnection, #517). */
  connection?: string;
  readMigrations(): Promise<MigrationFile[]>;
  /** The record store, or null when R2 isn't configured. It may throw when R2's settings are invalid. */
  openStore(): DeployRecordStore | null;
  /** Runs `prisma migrate deploy`; true when it succeeded. */
  migrate(): Promise<boolean>;
  log(message: string): void;
  now(): Date;
};

export type DeployMigrationsResult =
  | { status: "not-this-build" }
  | { status: "skipped"; record: DeployRecord }
  | { status: "migrated"; reason: string; recorded: boolean }
  | { status: "failed"; reason: string };

/**
 * Runs or skips `prisma migrate deploy` for this build, and says why in the build log.
 * Anything it can't be sure of (no record, no R2, an R2 error, unreadable migrations)
 * runs the step, as every build did before CU-04.
 */
export async function runDeployMigrations(input: DeployMigrationsInput): Promise<DeployMigrationsResult> {
  const { env, log } = input;
  const target = deployTarget(env);
  if (!target) {
    // Without its own database a preview would share production's, so it must not migrate.
    log(`Skipping prisma migrate deploy (VERCEL_ENV=${env.VERCEL_ENV ?? "unset"}, no separate preview database).`);
    return { status: "not-this-build" };
  }

  // Why this build runs the step; it stays unset only while skipping is still possible.
  let reason: string | undefined;
  let digest: string | null = null;
  let count = 0;
  let store: DeployRecordStore | null = null;
  const fingerprint = databaseFingerprint(input.databaseUrl);

  try {
    const migrations = await input.readMigrations();
    digest = migrationsDigest(migrations);
    count = migrations.length;
  } catch (error) {
    reason = `prisma/migrations couldn't be read (${errorName(error)})`;
  }
  try {
    store = input.openStore();
  } catch (error) {
    reason ??= `R2's settings are invalid (${errorName(error)}), so there's no record of earlier deploys`;
  }

  if (alwaysRunMigrations(env)) {
    reason = "ALWAYS_RUN_MIGRATIONS is true";
  } else if (!reason) {
    if (!store) {
      reason = "R2 isn't configured, so there's no record of earlier deploys";
    } else if (!fingerprint) {
      reason = "the database URL couldn't be read";
    } else {
      let record: DeployRecord | null = null;
      try {
        record = parseDeployRecord(await store.get(deployRecordKey(fingerprint)));
      } catch (error) {
        reason = `the record in R2 couldn't be read (${errorName(error)})`;
      }
      if (!reason && record && record.digest === digest) {
        log(
          `Skipping prisma migrate deploy: this build's ${count} migrations were all applied to the ${target} database by ${describeDeploy(record)} (recorded in R2), so the build doesn't wake it. Set ALWAYS_RUN_MIGRATIONS=true to run it anyway.`,
        );
        return { status: "skipped", record };
      }
      reason ??= record ? `the migrations changed since ${describeDeploy(record)}` : "there's no record of an earlier deploy to this database";
    }
  }

  log(`Running prisma migrate deploy against the ${target} database: ${reason}.`);
  if (input.connection) log(`Prisma connects with ${input.connection}.`);
  if (!(await input.migrate())) return { status: "failed", reason };

  // Only a successful run is recorded, and only what this build carried.
  let recorded = false;
  if (store && fingerprint && digest) {
    const record: DeployRecord = {
      version: 1,
      digest,
      migrations: count,
      commit: env.VERCEL_GIT_COMMIT_SHA?.trim() || null,
      appliedAt: input.now().toISOString(),
    };
    try {
      await store.put(deployRecordKey(fingerprint), `${JSON.stringify(record)}\n`);
      recorded = true;
      log("Recorded the applied migrations in R2, so the next deploy without new ones skips this step.");
    } catch (error) {
      log(`Couldn't record the applied migrations in R2 (${errorName(error)}); the next deploy runs prisma migrate deploy again.`);
    }
  }
  return { status: "migrated", reason, recorded };
}
