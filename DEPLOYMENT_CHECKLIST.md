# First Vercel Deploy Checklist

Use this checklist before the first production deployment of AI Multi to Vercel with hosted PostgreSQL, Vercel Blob, and private S3 video storage.

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

Email (invitations and password resets). `APP_BASE_URL` is required on Vercel production, because email links are built from it. Pick one provider:

```env
APP_BASE_URL="https://your-production-app.example.com"

# Gmail SMTP (free): a dedicated Gmail account with 2-Step Verification and an app password
EMAIL_PROVIDER="smtp"
SMTP_USER="your-app@gmail.com"
SMTP_PASS="your gmail app password"
# SMTP_HOST and SMTP_PORT default to smtp.gmail.com and 465

# Brevo (free tier, HTTP API)
EMAIL_PROVIDER="brevo"
BREVO_API_KEY="xkeysib-your-brevo-key"
EMAIL_FROM="AI Multi <sender-verified-in-brevo@example.com>"

# Resend (delivers only to your own address until you verify a domain)
EMAIL_PROVIDER="resend"
RESEND_API_KEY="re_your_resend_api_key"
EMAIL_FROM="AI Multi <noreply@example.com>"
```

Email notifications are disabled when `EMAIL_PROVIDER` is omitted or set to `"disabled"`. In-app invitations continue to work either way. Keep every key and password server-only, with no `NEXT_PUBLIC_` prefix. With Gmail SMTP, mail is sent from `SMTP_USER` under the app's name. Each send waits at most 10 seconds for the mail server, so a slow server can't hang a request.

### Checking that emails reach the inbox

Every email is a complete HTML document with a matching plain-text part, the same sender, at most two links, and a footer saying who sent it and why (`src/lib/email-templates.ts`, #232). To see how a real email lands:

1. Put the production email settings (`EMAIL_PROVIDER` and its keys) in your local `.env`.
2. Open https://www.mail-tester.com and copy the address it shows.
3. Run `npm run email:test -- <that address>`. It sends the "confirm your email" message, with links pointing at production. Add `reset`, `invitation` or `all` after the address to send other emails, for example to your own inbox.
4. Back on mail-tester, check the score (aim for 9/10 or more) and what it lists to fix.

In Gmail, "Show original" on a received email should report `SPF: PASS`, `DKIM: PASS` and `DMARC: PASS`. If emails still land in junk, marking a few as "Not spam" teaches the filter. The strongest fix is sending from your own domain with SPF, DKIM and DMARC through Brevo's free plan, but a domain costs money.

### Sign in with Google (optional, free)

"Continue with Google" shows on the log in and sign up pages once `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set (#356). The first sign-in creates the account, already confirmed; later ones log in to it. Google doesn't charge for it and needs no billing account.

1. In the [Google Cloud console](https://console.cloud.google.com), create a project, such as "AI Multi".
2. Open **Google Auth Platform**, choose **Get started**, and fill in the app name, a support email and, for **Audience**, **External**.
3. Under **Clients**, choose **Create client**, then **Web application**. Add the authorized redirect URI `<APP_BASE_URL>/api/auth/google/callback`, for example `https://ai-multi-task-management-vercel.vercel.app/api/auth/google/callback`. Add `http://localhost:3000/api/auth/google/callback` too, to try it locally. Create it, then copy the **Client ID** and **Client secret**.
4. Under **Audience**, choose **Publish app**. While it says "Testing", only the test users listed there can sign in. The app asks only for the basic scopes (`openid`, `email`, `profile`), so it needs no review to publish.
5. In the checkout linked to Vercel, run `npx -y vercel@latest env add GOOGLE_CLIENT_ID production`, then the same for `GOOGLE_CLIENT_SECRET`, and paste each value when asked. They take effect with the next deploy.

Until the brand is verified (free, under **Branding**, but it takes a few days and needs a privacy policy link), Google's screen names the site's address instead of "AI Multi". Sign-in works either way. Google sign-in stays off on previews: their addresses change, and Google only sends people back to the redirect URIs listed in step 3.

### AI assistant (optional, free tier)

The AI assistant (#307) answers through a model provider, Gemini by default. Without `GEMINI_API_KEY` it's off and the rule-based planner answers instead, so the app works either way.

1. Create a free key in [Google AI Studio](https://aistudio.google.com) (**Get API key**). Don't set up billing: the free tier needs no card.
2. In the checkout linked to Vercel, run `npx -y vercel@latest env add GEMINI_API_KEY --environment production,preview --sensitive` and paste the key when asked. It takes effect with the next deploy.
3. Optional settings, all without code changes: `AI_MODEL` (default `gemini-3.1-flash-lite`), `AI_PROVIDER` (default `gemini`), and the daily caps on model requests, `AI_USER_DAILY_REQUESTS` (40 per person) and `AI_APP_DAILY_REQUESTS` (400 for everyone). Days run from midnight Pacific time, when Gemini resets its own quotas; keep the app's cap under the free tier's limit, about 500 requests a day on 3.1 Flash-Lite. `AI_APP_DAILY_REQUESTS="0"` switches the assistant off at once. Never set `AI_PROVIDER="fake"` on Vercel: it's for tests, and the build refuses it.

While `AI_FREE_TIER` is on (the default), people in the EEA, Switzerland and the UK get the planner instead: Gemini's free terms allow only paid services there. With a paid key, set `AI_FREE_TIER="false"`.

Nothing is sent for a person until they agree to the assistant's data notice. Each message is logged in the `AgentRun` table (outcome, model, tools called, tokens, latency; never the text), kept 90 days.

### AI apps over MCP (optional, free)

`/api/mcp` lets AI apps such as Claude and ChatGPT read a person's workspace (#478) once they sign in with OAuth and the person clicks Allow on the consent page (`/oauth/authorize`, #477), and the Integrations page (`/integrations`, #480) shows people how to connect them and which apps are connected. Until `MCP_ENABLED` is `"true"`, the endpoint, sign-in's endpoints and metadata answer 404, the pages show the not-found page (with a 200, like `/usage`, since pages stream), and nothing links to them.

1. In the checkout linked to Vercel, run `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))" | npx -y vercel@latest env add MCP_TOKEN_SECRET production --sensitive`. It generates the token signing secret and stores it without showing it.
2. Run `npx -y vercel@latest env add MCP_ENABLED production` and enter `true`. Both take effect with the next deploy, and the deploy check refuses `MCP_ENABLED="true"` without a secret of at least 32 characters.

Changing `MCP_TOKEN_SECRET` ends every access token at once; apps then refresh, so nobody has to connect again. Checking an access token needs no database, so starting a session and listing tools touch none; each tool call reads the grant and writes one row to `McpToolCall`, kept 30 days. Refreshing a token, about once an hour while an app is in use, is one request: four rate-limit counters (network, device, account and app), a read and a write, and one more read for an app that registered itself. Signing an app in is a handful of queries, once.

## Deployment environment validation

Run the deployment validator before the first Vercel deploy and after changing environment variables:

```bash
npm run validate:deploy-env
```

The same check runs automatically at the start of `npm run vercel-build`. It validates both storage routing targets and requires only the credentials used by those targets. It prints variable names and guidance only; it does not print secret values.

## Database and migrations

The Vercel Build Command runs:

```bash
npm run validate:deploy-env && prisma validate && prisma generate && node --conditions react-server --import tsx scripts/migrate-deployment-database.ts && next build
```

This means deployment environment variables are checked first, Prisma Client is generated during the build, and pending migrations are applied with Prisma's production-safe `migrate deploy` command before `next build` runs. Preview deployments have their own database: the Neon resource `ai-multi-task-preview`, connected to the Preview environment only with the `PREVIEW_` prefix. When `VERCEL_ENV` is `preview` and `PREVIEW_DATABASE_URL` is set, the app and Prisma use it instead of `DATABASE_URL` (`src/lib/database-url.ts`). `scripts/migrate-deployment-database.ts` runs `prisma migrate deploy` in production and in previews that have their own database; a preview without one would share production's database, so it skips migrations. A pull request's migrations reach production only when it is merged to `main`. The preview database starts empty and is shared by all previews. Use an empty or properly backed-up hosted PostgreSQL database for the first deployment. Do not run destructive reset commands, such as `prisma migrate reset`, against production.

Prisma's command-line tools, including `prisma migrate deploy`, connect with the direct (unpooled) address that Neon's integration sets beside the pooled one: `DATABASE_URL_UNPOOLED`, or `PREVIEW_DATABASE_URL_UNPOOLED` in previews with their own database (#517). `prisma migrate deploy` holds a Postgres advisory lock while it runs, and a lock taken through Neon's pooler can stay held after the run, so later migrations fail with `P1002: Timed out trying to acquire a postgres advisory lock`. The tools use the direct address only when it's the same database as the pooled one (same user, database, port and schema, and the same host once Neon's `-pooler` suffix is removed); otherwise, or when it isn't set, they use the pooled address. The build log names the address it used (`src/lib/database-url.ts`). The app keeps the pooled address, which is what serverless functions should use.

A deploy that brings no new migration skips `prisma migrate deploy`, so the build doesn't wake the database (#510): even with nothing to apply, the command connects, and each connection keeps Neon's compute awake for at least 5 minutes. After a successful run the build stores a small record in R2, `deploy-migrations/<fingerprint>.json`: a SHA-256 of every migration's name and SQL, the commit and the time. The fingerprint is a SHA-256 of the database's user, host, port, name and schema, never the URL or password. The next build skips the step only when its migrations hash to the same value for the same database. It runs the step as before when a migration is new or changed, when there's no record, when R2 isn't configured or answers with an error, and when `ALWAYS_RUN_MIGRATIONS` is `true`. The build log says which it did and why. The logic and its tests are in `src/lib/deploy-migrations-core.ts`.

The record can only go stale if the same database is rolled back in place, for example with a point-in-time restore in Neon's console, to before a migration it lists. In that case set `ALWAYS_RUN_MIGRATIONS=true` in Vercel, redeploy so the migrations are applied again, then remove the variable; the deploy check warns while it's on. Restoring a backup into a new database (see the README's "Database backups") needs nothing, because a new database has a different fingerprint.

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

`EMAIL_PROVIDER` may be omitted or set to `"disabled"` for in-app-only invitations. `npm run validate:deploy-env` requires `SMTP_USER` and `SMTP_PASS` for `"smtp"`, `BREVO_API_KEY` and `EMAIL_FROM` for `"brevo"`, and `RESEND_API_KEY` and `EMAIL_FROM` for `"resend"`. If `EMAIL_PROVIDER` is any other value, validation fails clearly without printing secret values.

### Disabled signup or guest login

When `SIGNUP_ENABLED="false"`, public signup is unavailable by design. When `GUEST_LOGIN_ENABLED="false"`, guest login is unavailable by design. Re-enable either only if you intentionally want public account creation or guest workspaces.
