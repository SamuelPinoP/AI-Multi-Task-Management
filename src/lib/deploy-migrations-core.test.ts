import assert from "node:assert/strict";
import test from "node:test";
import {
  DEPLOY_RECORD_PREFIX,
  alwaysRunMigrations,
  databaseFingerprint,
  deployRecordKey,
  deployTarget,
  migrationsDigest,
  parseDeployRecord,
  runDeployMigrations,
  type DeployMigrationsInput,
  type DeployRecord,
  type DeployRecordStore,
  type MigrationFile,
} from "./deploy-migrations-core";

const PRODUCTION_URL = "postgresql://app_owner:s3cret@ep-quiet-sun-123456.us-east-2.aws.neon.tech/app?sslmode=require";
const PREVIEW_URL = "postgresql://app_owner:other@ep-calm-sea-654321.us-east-2.aws.neon.tech/app?sslmode=require";
const MIGRATIONS: MigrationFile[] = [
  { name: "20260101000000_init", sql: "CREATE TABLE \"User\" (id text);" },
  { name: "20260201000000_add_tasks", sql: "CREATE TABLE \"Task\" (id text);" },
];
const NOW = new Date("2026-11-20T04:05:06.000Z");
const COMMIT = "0123456789abcdef0123456789abcdef01234567";

/** A stand-in for R2 that records every call. */
function memoryStore(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial));
  const calls: string[] = [];
  const store: DeployRecordStore = {
    async get(key) {
      calls.push(`get ${key}`);
      return files.get(key) ?? null;
    },
    async put(key, body) {
      calls.push(`put ${key}`);
      files.set(key, body);
    },
  };
  return { store, files, calls };
}

function recordFor(migrations: MigrationFile[], extra: Partial<DeployRecord> = {}): DeployRecord {
  return {
    version: 1,
    digest: migrationsDigest(migrations),
    migrations: migrations.length,
    commit: "fedcba9876543210fedcba9876543210fedcba98",
    appliedAt: "2026-11-19T22:30:00.000Z",
    ...extra,
  };
}

const productionKey = deployRecordKey(databaseFingerprint(PRODUCTION_URL)!);

/** Runs the step with stand-ins; anything not given behaves like a production build with R2. */
async function run(overrides: Partial<DeployMigrationsInput> & { store?: DeployRecordStore | null; migrateOk?: boolean } = {}) {
  const logs: string[] = [];
  let migrateCalls = 0;
  let storeOpened = false;
  const { store = memoryStore().store, migrateOk = true, ...input } = overrides;
  const result = await runDeployMigrations({
    env: { VERCEL_ENV: "production", VERCEL_GIT_COMMIT_SHA: COMMIT },
    databaseUrl: PRODUCTION_URL,
    readMigrations: async () => MIGRATIONS,
    openStore: () => {
      storeOpened = true;
      return store;
    },
    migrate: async () => {
      migrateCalls += 1;
      return migrateOk;
    },
    log: (message) => logs.push(message),
    now: () => NOW,
    ...input,
  });
  return { result, logs, migrateCalls, storeOpened };
}

test("the migrations' hash ignores order and changes with any name or SQL", () => {
  const digest = migrationsDigest(MIGRATIONS);
  assert.match(digest, /^[0-9a-f]{64}$/);
  assert.equal(migrationsDigest([...MIGRATIONS].reverse()), digest);
  assert.notEqual(migrationsDigest([MIGRATIONS[0], { ...MIGRATIONS[1], sql: `${MIGRATIONS[1].sql}\n` }]), digest);
  assert.notEqual(migrationsDigest([MIGRATIONS[0], { ...MIGRATIONS[1], name: "20260201000000_add_todos" }]), digest);
  assert.notEqual(migrationsDigest(MIGRATIONS.slice(0, 1)), digest);
  assert.notEqual(migrationsDigest([...MIGRATIONS, { name: "20260301000000_add_notes", sql: "" }]), digest);
  // Name and SQL can't run together into the same text.
  assert.notEqual(migrationsDigest([{ name: "a", sql: "bc" }]), migrationsDigest([{ name: "ab", sql: "c" }]));
});

test("a database's fingerprint names the database, never the password", () => {
  const fingerprint = databaseFingerprint(PRODUCTION_URL)!;
  assert.match(fingerprint, /^[0-9a-f]{64}$/);
  assert.equal(databaseFingerprint(PRODUCTION_URL.replace("s3cret", "rotated")), fingerprint, "a new password is the same database");
  assert.equal(databaseFingerprint(PRODUCTION_URL.replace("?sslmode=require", "?sslmode=verify-full&connect_timeout=10")), fingerprint);
  assert.equal(databaseFingerprint(PRODUCTION_URL.replace(".neon.tech/", ".neon.tech:5432/")), fingerprint, "5432 is the default port");
  assert.equal(databaseFingerprint(PRODUCTION_URL.replace("ep-quiet-sun", "EP-QUIET-SUN")), fingerprint, "host names ignore case");
  assert.equal(databaseFingerprint(PRODUCTION_URL.replace("postgresql:", "postgres:")), fingerprint);
  assert.equal(databaseFingerprint(`${PRODUCTION_URL}&schema=public`), fingerprint, "public is the default schema");

  for (const other of [
    PREVIEW_URL,
    PRODUCTION_URL.replace("ep-quiet-sun-123456", "ep-quiet-sun-123456-pooler"),
    PRODUCTION_URL.replace("/app?", "/app_restored?"),
    PRODUCTION_URL.replace("app_owner", "app_reader"),
    PRODUCTION_URL.replace(".neon.tech/", ".neon.tech:6543/"),
    `${PRODUCTION_URL}&schema=staging`,
  ]) {
    assert.notEqual(databaseFingerprint(other), fingerprint, other);
  }

  for (const unreadable of [undefined, "", "not a url", "mysql://user:pass@host/db", "postgresql:///app"]) {
    assert.equal(databaseFingerprint(unreadable), null, String(unreadable));
  }
});

test("records live under deploy-migrations/ by fingerprint", () => {
  const fingerprint = databaseFingerprint(PRODUCTION_URL)!;
  assert.equal(deployRecordKey(fingerprint), `${DEPLOY_RECORD_PREFIX}${fingerprint}.json`);
  assert.equal(DEPLOY_RECORD_PREFIX, "deploy-migrations/");
});

test("only a well-formed record is trusted", () => {
  const record = recordFor(MIGRATIONS);
  assert.deepEqual(parseDeployRecord(JSON.stringify(record)), record);
  assert.deepEqual(parseDeployRecord(JSON.stringify({ ...record, commit: null })), { ...record, commit: null });
  assert.deepEqual(parseDeployRecord(JSON.stringify({ ...record, extra: "ignored" })), record);

  for (const bad of [
    null,
    "",
    "{",
    "[]",
    "null",
    JSON.stringify({ ...record, version: 2 }),
    JSON.stringify({ ...record, digest: "abc" }),
    JSON.stringify({ ...record, digest: record.digest.toUpperCase() }),
    JSON.stringify({ ...record, migrations: -1 }),
    JSON.stringify({ ...record, migrations: 1.5 }),
    JSON.stringify({ ...record, commit: 7 }),
    JSON.stringify({ ...record, appliedAt: "yesterday" }),
    JSON.stringify({ digest: record.digest }),
  ]) {
    assert.equal(parseDeployRecord(bad), null, String(bad));
  }
});

test("production and previews with their own database migrate; other builds don't", () => {
  assert.equal(deployTarget({ VERCEL_ENV: "production" }), "production");
  assert.equal(deployTarget({ VERCEL_ENV: "preview", PREVIEW_DATABASE_URL: PREVIEW_URL }), "preview");
  assert.equal(deployTarget({ VERCEL_ENV: "preview", PREVIEW_DATABASE_URL: "  " }), null);
  assert.equal(deployTarget({ VERCEL_ENV: "preview" }), null);
  assert.equal(deployTarget({ VERCEL_ENV: "development" }), null);
  assert.equal(deployTarget({}), null);
});

test("ALWAYS_RUN_MIGRATIONS is on only when it's true", () => {
  assert.equal(alwaysRunMigrations({ ALWAYS_RUN_MIGRATIONS: "true" }), true);
  assert.equal(alwaysRunMigrations({ ALWAYS_RUN_MIGRATIONS: " true " }), true);
  for (const value of [undefined, "", "false", "1", "yes", "TRUE"]) {
    assert.equal(alwaysRunMigrations({ ALWAYS_RUN_MIGRATIONS: value }), false, String(value));
  }
});

test("a preview without its own database skips migrations, without touching R2", async () => {
  const { result, logs, migrateCalls, storeOpened } = await run({ env: { VERCEL_ENV: "preview" } });
  assert.deepEqual(result, { status: "not-this-build" });
  assert.equal(migrateCalls, 0);
  assert.equal(storeOpened, false);
  assert.deepEqual(logs, ["Skipping prisma migrate deploy (VERCEL_ENV=preview, no separate preview database)."]);
});

test("the first deploy migrates and records what it applied", async () => {
  const { store, files, calls } = memoryStore();
  const { result, logs, migrateCalls } = await run({ store });
  assert.deepEqual(result, { status: "migrated", reason: "there's no record of an earlier deploy to this database", recorded: true });
  assert.equal(migrateCalls, 1);
  assert.deepEqual(calls, [`get ${productionKey}`, `put ${productionKey}`]);
  assert.deepEqual(JSON.parse(files.get(productionKey)!), {
    version: 1,
    digest: migrationsDigest(MIGRATIONS),
    migrations: 2,
    commit: COMMIT,
    appliedAt: NOW.toISOString(),
  });
  assert.equal(logs[0], "Running prisma migrate deploy against the production database: there's no record of an earlier deploy to this database.");
});

test("the stored record holds no part of the database URL", async () => {
  const { store, files } = memoryStore();
  await run({ store });
  const stored = [...files.entries()].join("\n");
  for (const secret of ["s3cret", "app_owner", "ep-quiet-sun", "neon.tech", "sslmode"]) {
    assert.equal(stored.includes(secret), false, secret);
  }
});

test("a deploy with the same migrations skips the step and never runs Prisma", async () => {
  const { store, calls } = memoryStore({ [productionKey]: JSON.stringify(recordFor(MIGRATIONS)) });
  const { result, logs, migrateCalls } = await run({ store, readMigrations: async () => [...MIGRATIONS].reverse() });
  assert.equal(result.status, "skipped");
  assert.equal(migrateCalls, 0);
  assert.deepEqual(calls, [`get ${productionKey}`], "nothing is written");
  assert.deepEqual(logs, [
    "Skipping prisma migrate deploy: this build's 2 migrations were all applied to the production database by the deploy of fedcba9 on 2026-11-19 22:30 UTC (recorded in R2), so the build doesn't wake it. Set ALWAYS_RUN_MIGRATIONS=true to run it anyway.",
  ]);
});

test("a new or edited migration runs the step and updates the record", async () => {
  const added = [...MIGRATIONS, { name: "20261120000000_add_notes", sql: "CREATE TABLE \"Note\" (id text);" }];
  const { store, files } = memoryStore({ [productionKey]: JSON.stringify(recordFor(MIGRATIONS)) });
  const { result, migrateCalls } = await run({ store, readMigrations: async () => added });
  assert.deepEqual(result, { status: "migrated", reason: "the migrations changed since the deploy of fedcba9 on 2026-11-19 22:30 UTC", recorded: true });
  assert.equal(migrateCalls, 1);
  assert.equal(parseDeployRecord(files.get(productionKey)!)?.digest, migrationsDigest(added));
  assert.equal(parseDeployRecord(files.get(productionKey)!)?.migrations, 3);

  const edited = [MIGRATIONS[0], { ...MIGRATIONS[1], sql: "CREATE TABLE \"Task\" (id text, title text);" }];
  const second = await run({ store: memoryStore({ [productionKey]: JSON.stringify(recordFor(MIGRATIONS)) }).store, readMigrations: async () => edited });
  assert.equal(second.result.status, "migrated");
  assert.equal(second.migrateCalls, 1);
});

test("a record without a commit still names when it was made", async () => {
  const { store } = memoryStore({ [productionKey]: JSON.stringify(recordFor(MIGRATIONS, { commit: null })) });
  const { logs } = await run({ store });
  assert.match(logs[0], /applied to the production database by a deploy on 2026-11-19 22:30 UTC \(recorded in R2\)/);
});

test("ALWAYS_RUN_MIGRATIONS=true runs the step even when the record matches", async () => {
  const { store, calls } = memoryStore({ [productionKey]: JSON.stringify(recordFor(MIGRATIONS)) });
  const { result, migrateCalls } = await run({ store, env: { VERCEL_ENV: "production", ALWAYS_RUN_MIGRATIONS: "true" } });
  assert.deepEqual(result, { status: "migrated", reason: "ALWAYS_RUN_MIGRATIONS is true", recorded: true });
  assert.equal(migrateCalls, 1);
  assert.deepEqual(calls, [`put ${productionKey}`], "the record isn't even read");
});

test("another database never matches the record, so a restore into a new branch migrates", async () => {
  const { store } = memoryStore({ [productionKey]: JSON.stringify(recordFor(MIGRATIONS)) });
  const restored = PRODUCTION_URL.replace("ep-quiet-sun-123456", "ep-restored-777777");
  const { result, migrateCalls } = await run({ store, databaseUrl: restored });
  assert.equal(result.status, "migrated");
  assert.equal(migrateCalls, 1);
});

test("a preview with its own database keeps its own record", async () => {
  const previewKey = deployRecordKey(databaseFingerprint(PREVIEW_URL)!);
  const { store, files } = memoryStore({ [productionKey]: JSON.stringify(recordFor(MIGRATIONS)) });
  const env = { VERCEL_ENV: "preview", PREVIEW_DATABASE_URL: PREVIEW_URL };
  const first = await run({ store, env, databaseUrl: PREVIEW_URL });
  assert.equal(first.result.status, "migrated", "production's record doesn't count for the preview database");
  assert.match(first.logs[0], /against the preview database/);
  assert.ok(files.has(previewKey));

  const second = await run({ store, env, databaseUrl: PREVIEW_URL });
  assert.equal(second.result.status, "skipped");
  assert.match(second.logs[0], /applied to the preview database/);
});

test("without R2 every deploy migrates, as before", async () => {
  const { result, migrateCalls } = await run({ store: null });
  assert.deepEqual(result, { status: "migrated", reason: "R2 isn't configured, so there's no record of earlier deploys", recorded: false });
  assert.equal(migrateCalls, 1);
});

test("invalid R2 settings don't stop the deploy: it migrates", async () => {
  class ProjectChatStorageConfigError extends Error {
    name = "ProjectChatStorageConfigError";
  }
  const { result, migrateCalls } = await run({
    openStore: () => {
      throw new ProjectChatStorageConfigError("AWS S3 storage requires AWS_REGION and AWS_S3_BUCKET_NAME.");
    },
  });
  assert.deepEqual(result, {
    status: "migrated",
    reason: "R2's settings are invalid (ProjectChatStorageConfigError), so there's no record of earlier deploys",
    recorded: false,
  });
  assert.equal(migrateCalls, 1);
});

test("an R2 read error migrates, then still tries to record", async () => {
  const { store, files } = memoryStore();
  const failingRead: DeployRecordStore = {
    async get() {
      const error = new Error("Access denied");
      error.name = "AccessDenied";
      throw error;
    },
    put: store.put,
  };
  const { result, migrateCalls } = await run({ store: failingRead });
  assert.deepEqual(result, { status: "migrated", reason: "the record in R2 couldn't be read (AccessDenied)", recorded: true });
  assert.equal(migrateCalls, 1);
  assert.ok(files.has(productionKey));
});

test("an unreadable record counts as none", async () => {
  const { store } = memoryStore({ [productionKey]: "{ not json" });
  const { result, migrateCalls } = await run({ store });
  assert.equal(result.status, "migrated");
  assert.equal(migrateCalls, 1);
});

test("a failed migration fails the build and records nothing", async () => {
  const { store, calls } = memoryStore();
  const { result } = await run({ store, migrateOk: false });
  assert.deepEqual(result, { status: "failed", reason: "there's no record of an earlier deploy to this database" });
  assert.deepEqual(calls, [`get ${productionKey}`]);

  const matching = memoryStore({ [productionKey]: JSON.stringify(recordFor(MIGRATIONS)) });
  const forced = await run({ store: matching.store, env: { VERCEL_ENV: "production", ALWAYS_RUN_MIGRATIONS: "true" }, migrateOk: false });
  assert.equal(forced.result.status, "failed");
  assert.equal(matching.files.get(productionKey), JSON.stringify(recordFor(MIGRATIONS)), "the old record stays as it was");
});

test("a failed R2 write keeps the deploy going", async () => {
  const failingWrite: DeployRecordStore = {
    async get() {
      return null;
    },
    async put() {
      throw new Error("timed out");
    },
  };
  const { result, logs } = await run({ store: failingWrite });
  assert.deepEqual(result, { status: "migrated", reason: "there's no record of an earlier deploy to this database", recorded: false });
  assert.equal(logs.at(-1), "Couldn't record the applied migrations in R2 (Error); the next deploy runs prisma migrate deploy again.");
});

test("unreadable migrations run the step and record nothing", async () => {
  const { store, calls } = memoryStore({ [productionKey]: JSON.stringify(recordFor(MIGRATIONS)) });
  const { result, migrateCalls } = await run({
    store,
    readMigrations: async () => {
      const error = new Error("ENOENT: no such file or directory");
      error.name = "ENOENT";
      throw error;
    },
  });
  assert.deepEqual(result, { status: "migrated", reason: "prisma/migrations couldn't be read (ENOENT)", recorded: false });
  assert.equal(migrateCalls, 1);
  assert.deepEqual(calls, [], "neither read nor written");
});

test("an unreadable database URL migrates and lets Prisma report it", async () => {
  const { store, calls } = memoryStore();
  const { result, migrateCalls } = await run({ store, databaseUrl: undefined });
  assert.deepEqual(result, { status: "migrated", reason: "the database URL couldn't be read", recorded: false });
  assert.equal(migrateCalls, 1);
  assert.deepEqual(calls, []);
});

test("the build log names the connection Prisma uses when it runs (#517)", async () => {
  const { logs } = await run({ connection: "DATABASE_URL_UNPOOLED, the direct connection" });
  assert.deepEqual(logs.slice(0, 2), [
    "Running prisma migrate deploy against the production database: there's no record of an earlier deploy to this database.",
    "Prisma connects with DATABASE_URL_UNPOOLED, the direct connection.",
  ]);

  // A skipped build doesn't connect, so it doesn't name a connection.
  const { store } = memoryStore({ [productionKey]: JSON.stringify(recordFor(MIGRATIONS)) });
  const skipped = await run({ store, connection: "DATABASE_URL_UNPOOLED, the direct connection" });
  assert.equal(skipped.logs.length, 1);
  assert.match(skipped.logs[0], /^Skipping prisma migrate deploy/);
});
