import assert from "node:assert/strict";
import test from "node:test";
import { describeMigrationConnection, isSameDatabase, resolveDatabaseUrl, resolveMigrationDatabaseUrl } from "./database-url";

const production = "postgresql://prod.example/app";
const preview = "postgresql://preview.example/app";

test("previews use their own database when it is configured", () => {
  assert.equal(
    resolveDatabaseUrl({ VERCEL_ENV: "preview", DATABASE_URL: production, PREVIEW_DATABASE_URL: preview }),
    preview,
  );
});

test("production never uses the preview database", () => {
  assert.equal(
    resolveDatabaseUrl({ VERCEL_ENV: "production", DATABASE_URL: production, PREVIEW_DATABASE_URL: preview }),
    production,
  );
});

test("local development and CI use DATABASE_URL", () => {
  assert.equal(resolveDatabaseUrl({ DATABASE_URL: production, PREVIEW_DATABASE_URL: preview }), production);
});

test("a preview without its own database falls back to DATABASE_URL", () => {
  assert.equal(resolveDatabaseUrl({ VERCEL_ENV: "preview", DATABASE_URL: production, PREVIEW_DATABASE_URL: " " }), production);
});

test("returns undefined when nothing is configured", () => {
  assert.equal(resolveDatabaseUrl({}), undefined);
  assert.equal(resolveDatabaseUrl({ DATABASE_URL: "  " }), undefined);
});

// #517: Prisma's command-line tools take the direct address when it's the same database.
const pooledProd = "postgresql://owner:pw@ep-quiet-sun-123456-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require";
const directProd = "postgresql://owner:pw@ep-quiet-sun-123456.us-east-2.aws.neon.tech/neondb?sslmode=require";
const pooledPreview = "postgresql://owner:other@ep-calm-sea-654321-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require";
const directPreview = "postgresql://owner:other@ep-calm-sea-654321.us-east-2.aws.neon.tech/neondb?sslmode=require";

test("production's CLI uses the direct address when it's the same database", () => {
  assert.deepEqual(resolveMigrationDatabaseUrl({ VERCEL_ENV: "production", DATABASE_URL: pooledProd, DATABASE_URL_UNPOOLED: directProd }), {
    url: directProd,
    variable: "DATABASE_URL_UNPOOLED",
    direct: true,
  });
});

test("a preview with its own database uses the preview's direct address", () => {
  const env = {
    VERCEL_ENV: "preview",
    DATABASE_URL: pooledProd,
    DATABASE_URL_UNPOOLED: directProd,
    PREVIEW_DATABASE_URL: pooledPreview,
    PREVIEW_DATABASE_URL_UNPOOLED: directPreview,
  };
  assert.deepEqual(resolveMigrationDatabaseUrl(env), { url: directPreview, variable: "PREVIEW_DATABASE_URL_UNPOOLED", direct: true });
});

test("a preview never migrates production, even when only production's direct address is set", () => {
  const env = { VERCEL_ENV: "preview", DATABASE_URL: pooledProd, DATABASE_URL_UNPOOLED: directProd, PREVIEW_DATABASE_URL: pooledPreview };
  assert.deepEqual(resolveMigrationDatabaseUrl(env), {
    url: pooledPreview,
    variable: "PREVIEW_DATABASE_URL",
    direct: false,
    fallbackReason: "PREVIEW_DATABASE_URL_UNPOOLED isn't set",
  });
  // And a preview "direct" address that points at production is refused.
  assert.equal(resolveMigrationDatabaseUrl({ ...env, PREVIEW_DATABASE_URL_UNPOOLED: directProd })?.url, pooledPreview);
});

test("production never uses the preview's addresses", () => {
  const env = { VERCEL_ENV: "production", DATABASE_URL: pooledProd, PREVIEW_DATABASE_URL: pooledPreview, PREVIEW_DATABASE_URL_UNPOOLED: directPreview };
  assert.equal(resolveMigrationDatabaseUrl(env)?.url, pooledProd);
});

test("local development and CI, with only DATABASE_URL, keep using it", () => {
  assert.deepEqual(resolveMigrationDatabaseUrl({ DATABASE_URL: production }), {
    url: production,
    variable: "DATABASE_URL",
    direct: false,
    fallbackReason: "DATABASE_URL_UNPOOLED isn't set",
  });
  assert.equal(resolveMigrationDatabaseUrl({ DATABASE_URL: production, DATABASE_URL_UNPOOLED: "  " })?.url, production);
});

test("a direct address for another database is ignored", () => {
  for (const other of [
    directPreview,
    directProd.replace("/neondb?", "/restored?"),
    directProd.replace("owner:", "reader:"),
    directProd.replace(".neon.tech/", ".neon.tech:6543/"),
    `${directProd}&schema=staging`,
    "not a url",
    "mysql://owner:pw@ep-quiet-sun-123456.us-east-2.aws.neon.tech/neondb",
  ]) {
    assert.deepEqual(
      resolveMigrationDatabaseUrl({ DATABASE_URL: pooledProd, DATABASE_URL_UNPOOLED: other }),
      { url: pooledProd, variable: "DATABASE_URL", direct: false, fallbackReason: "DATABASE_URL_UNPOOLED points at a different database than DATABASE_URL" },
      other,
    );
  }
});

test("nothing configured gives nothing, so Prisma reports the missing variable", () => {
  assert.equal(resolveMigrationDatabaseUrl({}), undefined);
  assert.equal(resolveMigrationDatabaseUrl({ DATABASE_URL_UNPOOLED: directProd }), undefined);
});

test("the same database: only Neon's -pooler suffix, the password and connection options may differ", () => {
  assert.equal(isSameDatabase(pooledProd, directProd), true);
  assert.equal(isSameDatabase(pooledProd, directProd.replace("owner:pw", "owner:rotated")), true);
  assert.equal(isSameDatabase(pooledProd, directProd.replace("ep-quiet-sun", "EP-QUIET-SUN")), true);
  assert.equal(isSameDatabase("postgresql://app:app@db.internal:5432/app", "postgres://app:app@db.internal/app?connect_timeout=5"), true);
  // The suffix counts only at the end of the host's first label.
  assert.equal(isSameDatabase("postgresql://a@db.pooler-1.example/app", "postgresql://a@db.example/app"), false);
  assert.equal(isSameDatabase("postgresql://a@db-pooler.example/app", "postgresql://a@db-pooler-2.example/app"), false);
  assert.equal(isSameDatabase("not a url", "not a url"), false);
});

test("the build log names the address and, for the pooler, why", () => {
  assert.equal(describeMigrationConnection({ url: directProd, variable: "DATABASE_URL_UNPOOLED", direct: true }), "DATABASE_URL_UNPOOLED, the direct connection");
  assert.equal(
    describeMigrationConnection({ url: pooledProd, variable: "DATABASE_URL", direct: false, fallbackReason: "DATABASE_URL_UNPOOLED isn't set" }),
    "DATABASE_URL, through the pooler, because DATABASE_URL_UNPOOLED isn't set",
  );
});
