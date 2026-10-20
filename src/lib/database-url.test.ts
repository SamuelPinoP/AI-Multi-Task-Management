import assert from "node:assert/strict";
import test from "node:test";
import { resolveDatabaseUrl } from "./database-url";

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
