#!/usr/bin/env node
import "dotenv/config";

const ALLOWED_STORAGE_PROVIDERS = new Set(["local", "vercel-blob"]);
const ALLOWED_EMAIL_PROVIDERS = new Set(["disabled", "resend"]);
const BOOLEAN_ENV_NAMES = ["SIGNUP_ENABLED", "GUEST_LOGIN_ENABLED"];

function cleanEnvValue(name) {
  const value = process.env[name];
  return typeof value === "string" ? value.trim() : undefined;
}

function isProductionLikeEnvironment() {
  return process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
}

function isVercelProductionEnvironment() {
  return process.env.VERCEL === "1" && process.env.VERCEL_ENV === "production";
}

function addMissing(errors, name) {
  errors.push(`Missing ${name}. Add ${name} as a server-side environment variable before deploying.`);
}

const errors = [];
const warnings = [];
const isProductionLike = isProductionLikeEnvironment();
const isVercelProduction = isVercelProductionEnvironment();

const databaseUrl = cleanEnvValue("DATABASE_URL");
const storageProvider = cleanEnvValue("PROJECT_CHAT_STORAGE_PROVIDER");
const blobToken = cleanEnvValue("BLOB_READ_WRITE_TOKEN");
const emailProvider = cleanEnvValue("EMAIL_PROVIDER")?.toLowerCase();
const resendApiKey = cleanEnvValue("RESEND_API_KEY");
const emailFrom = cleanEnvValue("EMAIL_FROM");

if (!databaseUrl) {
  addMissing(errors, "DATABASE_URL");
}

if (!storageProvider) {
  if (isProductionLike) {
    addMissing(errors, "PROJECT_CHAT_STORAGE_PROVIDER");
  }
} else if (!ALLOWED_STORAGE_PROVIDERS.has(storageProvider)) {
  errors.push('Invalid PROJECT_CHAT_STORAGE_PROVIDER. Use either "local" or "vercel-blob".');
} else if (storageProvider === "vercel-blob" && !blobToken) {
  errors.push("Missing BLOB_READ_WRITE_TOKEN for Vercel Blob storage. Add it as a server-side secret environment variable.");
} else if (storageProvider === "local" && isProductionLike) {
  const message = 'PROJECT_CHAT_STORAGE_PROVIDER="local" is unsafe for production because serverless filesystem uploads are not durable. Use "vercel-blob" for Vercel production.';
  if (isVercelProduction) {
    errors.push(message);
  } else {
    warnings.push(message);
  }
}

if (emailProvider !== undefined && !ALLOWED_EMAIL_PROVIDERS.has(emailProvider)) {
  errors.push('Invalid EMAIL_PROVIDER. Omit it, use "disabled", or use "resend".');
} else if (emailProvider === "resend") {
  if (!resendApiKey) {
    errors.push('Missing RESEND_API_KEY for EMAIL_PROVIDER="resend". Add it as a server-side secret environment variable.');
  }
  if (!emailFrom) {
    errors.push('Missing EMAIL_FROM for EMAIL_PROVIDER="resend". Add a verified sender address as a server-side environment variable.');
  }
}

for (const name of BOOLEAN_ENV_NAMES) {
  const value = cleanEnvValue(name);
  if (value !== undefined && value !== "true" && value !== "false") {
    errors.push(`Invalid ${name}. Use "true" or "false" if this variable is set.`);
  }
}

if (warnings.length > 0) {
  console.warn("Deployment environment validation warnings:");
  for (const warning of warnings) {
    console.warn(`- ${warning}`);
  }
  console.warn("");
}

if (errors.length > 0) {
  console.error("Deployment environment validation failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  console.error("\nNo secret values were printed. Fix the variables above and run `npm run validate:deploy-env` again.");
  process.exit(1);
}

console.log("Deployment environment validation passed. No secret values were printed.");
