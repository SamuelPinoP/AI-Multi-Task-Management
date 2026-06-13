# First Vercel Deploy Checklist

Use this checklist before the first production deployment of AI-Multi Task-Management to Vercel with hosted PostgreSQL and Vercel Blob.

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
PROJECT_CHAT_STORAGE_PROVIDER="vercel-blob"
BLOB_READ_WRITE_TOKEN="your-vercel-blob-read-write-token"
SIGNUP_ENABLED="false"
GUEST_LOGIN_ENABLED="false"
```

- `DATABASE_URL` must point at the hosted PostgreSQL database that should receive production migrations.
- `PROJECT_CHAT_STORAGE_PROVIDER="vercel-blob"` is recommended for Vercel because local filesystem uploads are not durable in serverless production.
- `BLOB_READ_WRITE_TOKEN` is a server-only Vercel Blob secret. Never commit it, never expose it to client code, and never rename it with a `NEXT_PUBLIC_` prefix.
- `SIGNUP_ENABLED="false"` is recommended for the first public deployment unless public account creation is intentional.
- `GUEST_LOGIN_ENABLED="false"` is recommended for the first public deployment unless public guest workspaces are intentional.
- `SIGNUP_ENABLED` and `GUEST_LOGIN_ENABLED` must be exactly `"true"` or `"false"` if present; ambiguous values fail deployment validation.

Optional production variables:

```env
PROJECT_CHAT_BLOB_PREFIX="project-chat"
APP_BASE_URL="https://your-production-app.example.com"
EMAIL_PROVIDER="disabled"
```

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

The same check runs automatically at the start of `npm run vercel-build`. It fails with beginner-friendly messages for missing `DATABASE_URL`, missing `BLOB_READ_WRITE_TOKEN` when `PROJECT_CHAT_STORAGE_PROVIDER="vercel-blob"`, unsupported storage provider values, invalid email provider values, missing Resend variables when email is enabled, and unsafe Vercel production local-storage configuration. It prints variable names and guidance only; it does not print secret values.

## Database and migrations

The Vercel Build Command runs:

```bash
npm run validate:deploy-env && prisma validate && prisma generate && prisma migrate deploy && next build
```

This means deployment environment variables are checked first, Prisma Client is generated during the build, and pending migrations are applied with Prisma's production-safe `migrate deploy` command before `next build` runs. Use an empty or properly backed-up hosted PostgreSQL database for the first deployment. Do not run destructive reset commands, such as `prisma migrate reset`, against production.

If you prefer to separate migrations from the Vercel build step, run the same Prisma commands from a trusted machine or CI environment with the production `DATABASE_URL`, then deploy with the same migration state.

## Vercel Blob setup

1. Create or connect a Vercel Blob store for the Vercel project.
2. Add the Blob read/write token as `BLOB_READ_WRITE_TOKEN` in Vercel environment variables.
3. Set `PROJECT_CHAT_STORAGE_PROVIDER="vercel-blob"`.
4. Redeploy after changing Blob-related environment variables.

In production, the app will not silently fall back to local Project Chat attachment storage when `PROJECT_CHAT_STORAGE_PROVIDER` is omitted. Explicitly setting `PROJECT_CHAT_STORAGE_PROVIDER="local"` is allowed, but it is not recommended on Vercel because files written to the serverless filesystem are not durable.

## Troubleshooting

### Missing `DATABASE_URL`

`npm run validate:deploy-env` fails before Prisma runs if `DATABASE_URL` is missing. Add a hosted PostgreSQL connection string in Vercel and redeploy.

### Migration failure

`prisma migrate deploy` is non-destructive, but it can fail if the database is unreachable, credentials are wrong, required SSL settings are missing from the provider URL, or the database schema has drifted from the repository migrations. Check Vercel build logs, confirm the exact production `DATABASE_URL`, and inspect migration status from a trusted machine before retrying.

### Missing `BLOB_READ_WRITE_TOKEN`

`npm run validate:deploy-env` fails when `PROJECT_CHAT_STORAGE_PROVIDER="vercel-blob"` is selected without `BLOB_READ_WRITE_TOKEN`. Add the server-only Vercel Blob token and redeploy.

### Blob provider misconfiguration

If `PROJECT_CHAT_STORAGE_PROVIDER` has any value other than `local` or `vercel-blob`, `npm run validate:deploy-env` fails with a configuration error. Use `vercel-blob` for Vercel production.

### Invitation email configuration

`EMAIL_PROVIDER` may be omitted or set to `"disabled"` for in-app-only invitations. If `EMAIL_PROVIDER="resend"`, `npm run validate:deploy-env` requires both `RESEND_API_KEY` and `EMAIL_FROM`. If `EMAIL_PROVIDER` is any other value, validation fails clearly without printing secret values.

### Disabled signup or guest login

When `SIGNUP_ENABLED="false"`, public signup is unavailable by design. When `GUEST_LOGIN_ENABLED="false"`, guest login is unavailable by design. Re-enable either only if you intentionally want public account creation or guest workspaces.
