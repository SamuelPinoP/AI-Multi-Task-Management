# First Vercel Deploy Checklist

Use this checklist before the first production deployment of AI-Multi Task-Management to Vercel with hosted PostgreSQL, Vercel Blob, and private S3 video storage.

## Vercel project settings

1. Create or select the Vercel project for this repository.
2. Set the Vercel **Build Command** to:

   ```bash
   npm run vercel-build
   ```

3. Leave the normal install command as Vercel's default unless you have a specific package-manager reason to override it.

## Required production environment variables

Add these in Vercel Project Settings → Environment Variables for the production environment. Keep every value server-side only; none of these variables should use a `NEXT_PUBLIC_` prefix.

```env
DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/DATABASE?schema=public"
PROJECT_CHAT_DEFAULT_STORAGE_PROVIDER="vercel-blob"
PROJECT_CHAT_VIDEO_STORAGE_PROVIDER="aws-s3"
BLOB_READ_WRITE_TOKEN="your-vercel-blob-read-write-token"
AWS_REGION="us-east-1"
AWS_S3_BUCKET_NAME="your-private-bucket"
AWS_ACCESS_KEY_ID="your-dedicated-app-key"
AWS_SECRET_ACCESS_KEY="your-dedicated-app-secret"
SIGNUP_ENABLED="false"
GUEST_LOGIN_ENABLED="false"
```

- `DATABASE_URL` must point at the hosted PostgreSQL database that should receive production migrations.
- Use `vercel-blob` or `aws-s3` routing targets on Vercel because local filesystem uploads are not durable in serverless production.
- `BLOB_READ_WRITE_TOKEN` is a server-only Vercel Blob secret. Never commit it, never expose it to client code, and never rename it with a `NEXT_PUBLIC_` prefix.
- `AWS_REGION`, `AWS_S3_BUCKET_NAME`, and the AWS credentials are server-only values for the private S3 bucket used by video uploads. Never use `NEXT_PUBLIC_` for these variables.
- `SIGNUP_ENABLED="false"` is recommended for the first public deployment unless public account creation is intentional.
- `GUEST_LOGIN_ENABLED="false"` is recommended for the first public deployment unless public guest workspaces are intentional.
- `SIGNUP_ENABLED` and `GUEST_LOGIN_ENABLED` must be exactly `"true"` or `"false"` if present; ambiguous values fail deployment validation.

Optional production variables:

```env
PROJECT_CHAT_BLOB_PREFIX="project-chat"
PROJECT_CHAT_S3_PREFIX="project-chat"
PROJECT_CHAT_S3_QUOTA_BYTES="8589934592"
PROJECT_CHAT_USER_QUOTA_BYTES="524288000"
PROJECT_CHAT_GUEST_UPLOADS_ENABLED="false"
APP_BASE_URL="https://your-production-app.example.com"
EMAIL_PROVIDER="disabled"
```

- `PROJECT_CHAT_S3_QUOTA_BYTES` (default 8 GB) and `PROJECT_CHAT_USER_QUOTA_BYTES` (default 500 MB) cap the bytes stored with `aws-s3`, in total and per user. Uploads past either limit are refused with HTTP 413. Keep the total under your storage provider's free tier; Cloudflare R2 has no spending cap of its own. Values must be whole numbers of bytes.
- `PROJECT_CHAT_GUEST_UPLOADS_ENABLED` defaults to `"false"`, which blocks file uploads from guest users. It must be exactly `"true"` or `"false"` if present.

Optional Resend invitation email variables:

```env
EMAIL_PROVIDER="resend"
RESEND_API_KEY="re_your_resend_api_key"
EMAIL_FROM="AI-Multi Task-Management <noreply@example.com>"
APP_BASE_URL="https://your-production-app.example.com"
```

Invitation email notifications are disabled when `EMAIL_PROVIDER` is omitted or set to `"disabled"`. In-app invitations continue to work either way. If Resend is enabled, keep `RESEND_API_KEY` and `EMAIL_FROM` server-only with no `NEXT_PUBLIC_` prefix.

## Deployment environment validation

Run the deployment validator before the first Vercel deploy and after changing environment variables:

```bash
npm run validate:deploy-env
```

The same check runs automatically at the start of `npm run vercel-build`. It validates both storage routing targets and requires only the credentials used by those targets. It prints variable names and guidance only; it does not print secret values.

## Database and migrations

The Vercel Build Command runs:

```bash
npm run validate:deploy-env && prisma validate && prisma generate && node scripts/migrate-deployment-database.mjs && next build
```

This means deployment environment variables are checked first, Prisma Client is generated during the build, and pending migrations are applied with Prisma's production-safe `migrate deploy` command before `next build` runs. Preview deployments have their own database: the Neon resource `ai-multi-task-preview`, connected to the Preview environment only with the `PREVIEW_` prefix. When `VERCEL_ENV` is `preview` and `PREVIEW_DATABASE_URL` is set, the app and Prisma use it instead of `DATABASE_URL` (`src/lib/database-url.ts`). `scripts/migrate-deployment-database.mjs` runs `prisma migrate deploy` in production and in previews that have their own database; a preview without one would share production's database, so it skips migrations. A pull request's migrations reach production only when it is merged to `main`. The preview database starts empty and is shared by all previews. Use an empty or properly backed-up hosted PostgreSQL database for the first deployment. Do not run destructive reset commands, such as `prisma migrate reset`, against production.

If you prefer to separate migrations from the Vercel build step, run the same Prisma commands from a trusted machine or CI environment with the production `DATABASE_URL`, then deploy with the same migration state.

## Vercel Blob setup

1. Create or connect a Vercel Blob store for the Vercel project.
2. Add the Blob read/write token as `BLOB_READ_WRITE_TOKEN` in Vercel environment variables.
3. Set `PROJECT_CHAT_DEFAULT_STORAGE_PROVIDER="vercel-blob"` and `PROJECT_CHAT_VIDEO_STORAGE_PROVIDER="aws-s3"` (or select one cloud provider for both).
4. Redeploy after changing Blob-related environment variables.

In production, deployment validation requires an explicit default storage target. The deprecated `PROJECT_CHAT_STORAGE_PROVIDER` remains a temporary fallback, while explicit default/video variables take precedence. Do not select local on Vercel because serverless filesystem writes are not durable.

## AWS S3 setup

1. Create a private S3 bucket with Block all public access enabled.
2. Add bucket CORS for the exact deployed app origin so browser-direct presigned PUT uploads can succeed. Add `http://localhost:3000` only for local live testing.
3. Create a dedicated IAM user or role that can only `s3:PutObject`, `s3:GetObject`, and `s3:DeleteObject` under the configured project-chat prefix.
4. Add the AWS environment variables above in Vercel, redeploy, then upload/download/delete one disposable video before using production data.

See `docs/aws-s3-storage.md` for the exact CORS and IAM policy examples.

## Troubleshooting

### Missing `DATABASE_URL`

`npm run validate:deploy-env` fails before Prisma runs if `DATABASE_URL` is missing. Add a hosted PostgreSQL connection string in Vercel and redeploy.

### Migration failure

`prisma migrate deploy` is non-destructive, but it can fail if the database is unreachable, credentials are wrong, required SSL settings are missing from the provider URL, or the database schema has drifted from the repository migrations. Check Vercel build logs, confirm the exact production `DATABASE_URL`, and inspect migration status from a trusted machine before retrying.

### Missing `BLOB_READ_WRITE_TOKEN`

`npm run validate:deploy-env` fails when either routing target selects `vercel-blob` without `BLOB_READ_WRITE_TOKEN`. Add the server-only Vercel Blob token and redeploy.

### Blob provider misconfiguration

If any storage variable has a value other than `local`, `vercel-blob`, or `aws-s3`, deployment validation fails. Use durable cloud targets for Vercel production.

### Missing AWS S3 values

When any storage route selects `aws-s3`, `npm run validate:deploy-env` requires `AWS_REGION` and `AWS_S3_BUCKET_NAME`. If one static key variable is set, both `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` must be set. On Vercel, these should be encrypted server-side Environment Variables.

### Invitation email configuration

`EMAIL_PROVIDER` may be omitted or set to `"disabled"` for in-app-only invitations. If `EMAIL_PROVIDER="resend"`, `npm run validate:deploy-env` requires both `RESEND_API_KEY` and `EMAIL_FROM`. If `EMAIL_PROVIDER` is any other value, validation fails clearly without printing secret values.

### Disabled signup or guest login

When `SIGNUP_ENABLED="false"`, public signup is unavailable by design. When `GUEST_LOGIN_ENABLED="false"`, guest login is unavailable by design. Re-enable either only if you intentionally want public account creation or guest workspaces.
