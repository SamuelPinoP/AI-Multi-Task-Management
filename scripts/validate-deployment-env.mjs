#!/usr/bin/env node
import "dotenv/config";

const ALLOWED_STORAGE_PROVIDERS = new Set(["local", "vercel-blob", "aws-s3"]);
const ALLOWED_EMAIL_PROVIDERS = new Set(["disabled", "resend", "smtp", "brevo"]);
const BOOLEAN_ENV_NAMES = ["SIGNUP_ENABLED", "GUEST_LOGIN_ENABLED", "PROJECT_CHAT_GUEST_UPLOADS_ENABLED"];
const BYTE_LIMIT_ENV_NAMES = ["PROJECT_CHAT_S3_QUOTA_BYTES", "PROJECT_CHAT_USER_QUOTA_BYTES"];
// Cloudflare R2's free tier is 10 GB-month. Compare against decimal GB, the smaller reading.
const R2_FREE_TIER_BYTES = 10 * 1000 ** 3;

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
const legacyStorageProvider = cleanEnvValue("PROJECT_CHAT_STORAGE_PROVIDER");
const configuredDefaultStorageProvider = cleanEnvValue("PROJECT_CHAT_DEFAULT_STORAGE_PROVIDER");
const configuredVideoStorageProvider = cleanEnvValue("PROJECT_CHAT_VIDEO_STORAGE_PROVIDER");
const blobToken = cleanEnvValue("BLOB_READ_WRITE_TOKEN");
const emailProvider = cleanEnvValue("EMAIL_PROVIDER")?.toLowerCase();
const resendApiKey = cleanEnvValue("RESEND_API_KEY");
const emailFrom = cleanEnvValue("EMAIL_FROM");

if (!databaseUrl) {
  addMissing(errors, "DATABASE_URL");
}
if (process.env.VERCEL_ENV === "preview" && !cleanEnvValue("PREVIEW_DATABASE_URL")) {
  warnings.push("PREVIEW_DATABASE_URL is not set, so this preview uses the production database and skips migrations. Connect the preview Neon database to the Preview environment.");
}

for (const [name, value] of [
  ["PROJECT_CHAT_STORAGE_PROVIDER", legacyStorageProvider],
  ["PROJECT_CHAT_DEFAULT_STORAGE_PROVIDER", configuredDefaultStorageProvider],
  ["PROJECT_CHAT_VIDEO_STORAGE_PROVIDER", configuredVideoStorageProvider],
]) {
  if (value && !ALLOWED_STORAGE_PROVIDERS.has(value)) errors.push(`Invalid ${name}. Use "local", "vercel-blob", or "aws-s3".`);
}

if (legacyStorageProvider) {
  warnings.push("PROJECT_CHAT_STORAGE_PROVIDER is deprecated. Set PROJECT_CHAT_DEFAULT_STORAGE_PROVIDER and PROJECT_CHAT_VIDEO_STORAGE_PROVIDER; explicit new variables take precedence.");
}
if (isProductionLike && !configuredDefaultStorageProvider && !legacyStorageProvider) {
  addMissing(errors, "PROJECT_CHAT_DEFAULT_STORAGE_PROVIDER");
}

const defaultStorageProvider = configuredDefaultStorageProvider || legacyStorageProvider || "local";
const videoStorageProvider = configuredVideoStorageProvider || legacyStorageProvider || defaultStorageProvider;
const selectedStorageProviders = new Set([defaultStorageProvider, videoStorageProvider]);

if (selectedStorageProviders.has("vercel-blob") && !blobToken) {
  errors.push("Missing BLOB_READ_WRITE_TOKEN for Vercel Blob storage. Add it as a server-side secret environment variable.");
}
if (selectedStorageProviders.has("aws-s3")) {
  if (!cleanEnvValue("AWS_REGION")) addMissing(errors, "AWS_REGION");
  if (!cleanEnvValue("AWS_S3_BUCKET_NAME")) addMissing(errors, "AWS_S3_BUCKET_NAME");
  const accessKey = cleanEnvValue("AWS_ACCESS_KEY_ID");
  const secretKey = cleanEnvValue("AWS_SECRET_ACCESS_KEY");
  if (Boolean(accessKey) !== Boolean(secretKey)) {
    errors.push("Set both AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY, or omit both to use the AWS default credential provider chain.");
  }
  const forcePathStyle = cleanEnvValue("AWS_S3_FORCE_PATH_STYLE");
  if (forcePathStyle && forcePathStyle !== "true" && forcePathStyle !== "false") {
    errors.push('Invalid AWS_S3_FORCE_PATH_STYLE. Use "true" or "false" if this variable is set.');
  }
  const expiration = cleanEnvValue("AWS_S3_PRESIGNED_URL_EXPIRATION_SECONDS");
  if (expiration && (!Number.isInteger(Number(expiration)) || Number(expiration) < 60 || Number(expiration) > 3600)) {
    errors.push("AWS_S3_PRESIGNED_URL_EXPIRATION_SECONDS must be an integer from 60 through 3600.");
  }
}
if (selectedStorageProviders.has("local") && isProductionLike) {
  const message = 'A project-chat upload route selects "local" in production, but serverless filesystem uploads are not durable. Use "vercel-blob" or "aws-s3" for both production routing targets.';
  if (isVercelProduction) {
    errors.push(message);
  } else {
    warnings.push(message);
  }
}

if (emailProvider !== undefined && !ALLOWED_EMAIL_PROVIDERS.has(emailProvider)) {
  errors.push('Invalid EMAIL_PROVIDER. Omit it, or use "disabled", "resend", "smtp" or "brevo".');
} else if (emailProvider === "smtp") {
  if (!cleanEnvValue("SMTP_USER")) addMissing(errors, "SMTP_USER");
  if (!cleanEnvValue("SMTP_PASS")) {
    errors.push('Missing SMTP_PASS for EMAIL_PROVIDER="smtp". Use a Gmail app password, never the account password, as a server-side secret.');
  }
  const smtpPort = cleanEnvValue("SMTP_PORT");
  if (smtpPort && !/^\d+$/.test(smtpPort)) errors.push("Invalid SMTP_PORT. Use a port number such as 465.");
} else if (emailProvider === "brevo") {
  if (!cleanEnvValue("BREVO_API_KEY")) {
    errors.push('Missing BREVO_API_KEY for EMAIL_PROVIDER="brevo". Add it as a server-side secret environment variable.');
  }
  if (!emailFrom) {
    errors.push('Missing EMAIL_FROM for EMAIL_PROVIDER="brevo". Use a sender address verified in Brevo.');
  }
} else if (emailProvider === "resend") {
  if (!resendApiKey) {
    errors.push('Missing RESEND_API_KEY for EMAIL_PROVIDER="resend". Add it as a server-side secret environment variable.');
  }
  if (!emailFrom) {
    errors.push('Missing EMAIL_FROM for EMAIL_PROVIDER="resend". Add a verified sender address as a server-side environment variable.');
  }
}

// Password reset and invitation emails build their links from APP_BASE_URL.
const appBaseUrl = cleanEnvValue("APP_BASE_URL");
if (isVercelProduction && !appBaseUrl) {
  errors.push("Missing APP_BASE_URL. Without it, password reset and invitation links point to http://localhost:3000.");
} else if (appBaseUrl && !/^https?:\/\/[^\s/]+/.test(appBaseUrl)) {
  warnings.push("APP_BASE_URL should be the site's full address, such as https://your-app.vercel.app.");
}

const byteLimits = {};
for (const name of BYTE_LIMIT_ENV_NAMES) {
  const value = cleanEnvValue(name);
  if (!value) continue;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
    errors.push(`Invalid ${name}. Use a whole number of bytes, for example "8589934592" for 8 GB.`);
  } else {
    byteLimits[name] = Number(value);
  }
}
if (byteLimits.PROJECT_CHAT_S3_QUOTA_BYTES > R2_FREE_TIER_BYTES) {
  warnings.push("PROJECT_CHAT_S3_QUOTA_BYTES is above Cloudflare R2's 10 GB free tier. Uploads past 10 GB may be billed.");
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
