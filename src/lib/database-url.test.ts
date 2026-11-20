import assert from "node:assert/strict";
import test from "node:test";
import { directDatabaseUrl, resolveDatabaseUrl, resolveMigrationDatabaseUrl } from "./database-url";

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

// #515: Neon's pooled hosts end their first label in "-pooler"; migrations use the direct host.
const pooledProduction = "postgresql://app_owner:p%40ss%2Fw0rd@ep-sample-prod-a1b2c3d4-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require";
const directProduction = "postgresql://app_owner:p%40ss%2Fw0rd@ep-sample-prod-a1b2c3d4.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require";
const pooledPreview = "postgres://preview_owner:secret@ep-quiet-preview-9z8y7x6w-pooler.us-east-2.aws.neon.tech:5432/neondb?sslmode=require";
const directPreview = "postgres://preview_owner:secret@ep-quiet-preview-9z8y7x6w.us-east-2.aws.neon.tech:5432/neondb?sslmode=require";

test("migrations reach a Neon database directly, keeping the credentials and options as they are", () => {
  assert.equal(directDatabaseUrl(pooledProduction), directProduction);
  assert.equal(directDatabaseUrl(pooledPreview), directPreview);
  assert.equal(
    directDatabaseUrl("postgres://u:p@ep-old-store-12345678-pooler.us-east-1.postgres.vercel-storage.com/verceldb?sslmode=require"),
    "postgres://u:p@ep-old-store-12345678.us-east-1.postgres.vercel-storage.com/verceldb?sslmode=require",
  );
  assert.equal(directDatabaseUrl("postgresql://u:p@EP-LOUD-HOST-1-POOLER.US-EAST-2.AWS.NEON.TECH/db"), "postgresql://u:p@EP-LOUD-HOST-1.US-EAST-2.AWS.NEON.TECH/db");
});

test("URLs that aren't Neon's pooled ones stay exactly as they are", () => {
  for (const url of [
    directProduction,
    "postgresql://app:app@localhost:5441/app_test?schema=public",
    "postgresql://u:p@db-pooler.example.com/app",
    "postgresql://u:p@ep-plain-host-1.us-east-2.aws.neon.tech/app-pooler?application_name=x-pooler",
    "mysql://u:p@ep-x-pooler.us-east-2.aws.neon.tech/app",
    "not a url",
  ]) {
    assert.equal(directDatabaseUrl(url), url);
  }
});

test("migrations use the same database as the app, over a direct connection", () => {
  assert.equal(
    resolveMigrationDatabaseUrl({ VERCEL_ENV: "preview", DATABASE_URL: pooledProduction, PREVIEW_DATABASE_URL: pooledPreview }),
    directPreview,
  );
  assert.equal(
    resolveMigrationDatabaseUrl({ VERCEL_ENV: "production", DATABASE_URL: pooledProduction, PREVIEW_DATABASE_URL: pooledPreview }),
    directProduction,
  );
  assert.equal(resolveMigrationDatabaseUrl({ DATABASE_URL: production }), production);
  assert.equal(resolveMigrationDatabaseUrl({}), undefined);
});

test("the app keeps the pooled connection", () => {
  assert.equal(resolveDatabaseUrl({ VERCEL_ENV: "production", DATABASE_URL: pooledProduction }), pooledProduction);
  assert.equal(resolveDatabaseUrl({ VERCEL_ENV: "preview", DATABASE_URL: pooledProduction, PREVIEW_DATABASE_URL: pooledPreview }), pooledPreview);
});
