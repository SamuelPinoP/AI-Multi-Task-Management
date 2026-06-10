# AI-Multi Task-Management

AI-Multi Task-Management is a Next.js App Router application for team task management, notes, projects, calendars, project chat, search, trash, planning views, recurrence, guest mode, authentication, and dark mode.

## Getting Started

Install dependencies:

```bash
npm install
```

Create a local environment file from the safe example:

```bash
cp .env.example .env
```

Set `DATABASE_URL` in `.env` to your own local PostgreSQL database. Do not commit `.env` or real database credentials.

```env
DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/DATABASE?schema=public"
```

Prepare Prisma and the local database:

```bash
npx prisma validate
npx prisma generate
npx prisma migrate dev
```

Run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser.

## Database configuration

### Local development

Local development uses Prisma 7 with PostgreSQL. Runtime database access reads the server-only `DATABASE_URL` environment variable. Keep this value in `.env` for local development and never use a `NEXT_PUBLIC_` prefix for database secrets.

Required local variable:

```env
DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/DATABASE?schema=public"
```

Useful local commands:

```bash
npx prisma validate
npx prisma generate
npx prisma migrate dev
npm run build
```

Optional local access-control variables default to enabled when omitted:

```env
SIGNUP_ENABLED="true"
GUEST_LOGIN_ENABLED="true"
```

### Hosted deployment

For Vercel or another hosting provider, create a hosted PostgreSQL database with Neon, Supabase, Railway, or a similar provider. Add the production connection string as a server-side environment variable in the hosting provider settings:

```env
DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/DATABASE?schema=public"
```

Do not commit hosted credentials to Git. Do not expose database credentials to browser code, and do not name this variable with a `NEXT_PUBLIC_` prefix.

Before or during production deployment, run Prisma generation and apply production migrations. The repository includes a `vercel-build` script for Vercel's Build Command field:

```bash
npm run vercel-build
```

That script runs:

```bash
prisma validate && prisma generate && prisma migrate deploy && next build
```

## Font strategy

The app uses local system font stacks for sans-serif and monospace text instead of `next/font/google`. This avoids network-dependent Google Fonts fetching during local, CI, and hosted production builds.

## Prisma migration verification

The migration history now includes an initial baseline migration that creates the original base tables before the later feature migrations run, plus a small alignment migration that removes an index not declared in `prisma/schema.prisma`. This is intended to let a fresh empty PostgreSQL database use the normal production-safe Prisma flow and end in the schema described by Prisma.

To verify the migration baseline without touching your real local development database, create a separate empty PostgreSQL database such as `ai_multi_task_management_migration_test`, temporarily point `DATABASE_URL` at that test database, and run:

```bash
DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/ai_multi_task_management_migration_test?schema=public" npx prisma validate
DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/ai_multi_task_management_migration_test?schema=public" npx prisma generate
DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/ai_multi_task_management_migration_test?schema=public" npx prisma migrate deploy
```

After `migrate deploy` succeeds, keep using that same test `DATABASE_URL` if you want to run a build against the migrated schema:

```bash
DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/ai_multi_task_management_migration_test?schema=public" npm run build
```

Do not run destructive reset commands, such as `npx prisma migrate reset`, against your real local or hosted database. If you already have an existing development database that was created before the baseline migration was added, do not reset it just to apply the baseline; back it up first and use Prisma migration status/resolve guidance only after confirming which migrations are already represented in that database.

For future hosted PostgreSQL deployment on Vercel, Neon, Supabase, Railway, or a similar provider, set the hosted database connection string as a server-side `DATABASE_URL`, then run the same non-destructive production commands during deployment or from a trusted machine/CI environment:

```bash
npx prisma validate
npx prisma generate
npx prisma migrate deploy
npm run build
```


## Project Chat attachment storage

Project Chat attachments use a server-only storage helper so the API routes do not write directly to one hard-coded storage backend. Attachment metadata still uses the existing `ProjectCommentAttachment` fields; no Prisma schema change is required for choosing local storage or Vercel Blob.

### Local development provider

Use local storage when running the app on your machine:

```env
PROJECT_CHAT_STORAGE_PROVIDER="local"
PROJECT_CHAT_PUBLIC_UPLOAD_PATH="/uploads/project-chat"
```

- `PROJECT_CHAT_STORAGE_PROVIDER` selects the attachment backend. In development only, omitting it falls back to `local`.
- `PROJECT_CHAT_PUBLIC_UPLOAD_PATH` controls the public URL prefix saved in attachment metadata.
- Local files are written to `public/uploads/project-chat`, preserving existing local URLs such as `/uploads/project-chat/<filename>`.

To test local uploads:

1. Copy `.env.example` to `.env` and set your local `DATABASE_URL`.
2. Keep `PROJECT_CHAT_STORAGE_PROVIDER="local"`.
3. Run `npm run dev`.
4. Sign in, open a project, and post a Project Chat message with one or more supported attachments.
5. Confirm the message appears, the attachment opens from `/uploads/project-chat/...`, and the file exists under `public/uploads/project-chat`.
6. Delete that chat message and confirm the database comment is removed. The local file should be deleted when it exists; missing old local files are ignored safely.

Local storage is convenient for development, but it is not durable or safe for serverless production. Files written to a serverless filesystem can disappear between builds, instances, or cold starts. In production, the app will not silently fall back to local storage unless you explicitly set `PROJECT_CHAT_STORAGE_PROVIDER="local"`.

### Vercel Blob provider

Use Vercel Blob for hosted Project Chat attachments:

```env
PROJECT_CHAT_STORAGE_PROVIDER="vercel-blob"
BLOB_READ_WRITE_TOKEN="your-vercel-blob-read-write-token"
PROJECT_CHAT_BLOB_PREFIX="project-chat"
```

- `PROJECT_CHAT_STORAGE_PROVIDER="vercel-blob"` selects Vercel Blob.
- `BLOB_READ_WRITE_TOKEN` is a server-side secret. Never commit it, never expose it to browser code, and never rename it with a `NEXT_PUBLIC_` prefix.
- `PROJECT_CHAT_BLOB_PREFIX` controls the blob pathname prefix. The default is `project-chat`.

With this provider, uploads are saved with public blob URLs. The database stores the blob pathname, such as `project-chat/<uuid>.<ext>`, in `ProjectCommentAttachment.fileName`; it stores the human-readable original filename in `originalName`; and it stores the public Vercel Blob URL in `url` so the current image, video, and file UI can keep using direct links.

To test Vercel Blob after deployment:

1. Create or connect a Vercel Blob store for the deployed Vercel project.
2. Add `PROJECT_CHAT_STORAGE_PROVIDER="vercel-blob"` in the Vercel project environment variables.
3. Add `BLOB_READ_WRITE_TOKEN` as a Vercel secret/server-side environment variable.
4. Optionally add `PROJECT_CHAT_BLOB_PREFIX="project-chat"`.
5. Deploy normally after also setting production `DATABASE_URL`.
6. Sign in to the deployed app, open a project, and post a Project Chat message with an image, a non-image file, and optionally a video under the current size limits.
7. Confirm each attachment opens from a Vercel Blob URL, then delete the comment and confirm the blobs are removed or at least no longer shown in the app.

Existing local attachments do not automatically migrate to Vercel Blob. Old rows that point at `/uploads/project-chat/...` will keep working only where those local files still exist. If you need historical hosted attachments, plan a separate migration/backfill task.

Public Vercel Blob attachment URLs are accessible to anyone who has the URL. Private or protected attachment downloads would require a future signed-download flow or an auth-protected download route instead of direct public URLs.

## Vercel deployment readiness audit

Use this checklist before promoting a Vercel deployment. A shorter step-by-step runbook is also available in [`DEPLOYMENT_CHECKLIST.md`](DEPLOYMENT_CHECKLIST.md).

### First Vercel deploy checklist

1. Create a hosted PostgreSQL database and add its connection string to Vercel as the server-side `DATABASE_URL`.
2. Create or connect a Vercel Blob store, then add `PROJECT_CHAT_STORAGE_PROVIDER="vercel-blob"` and the server-only `BLOB_READ_WRITE_TOKEN`.
3. Set `SIGNUP_ENABLED="false"` and `GUEST_LOGIN_ENABLED="false"` for the first public deployment unless public signup or guest workspaces are intentional.
4. Set Vercel's Build Command to `npm run vercel-build`.
5. Deploy; the build validates Prisma, generates Prisma Client, runs `prisma migrate deploy`, and then runs `next build`.
6. After deployment, test login, disabled signup/guest states, project creation, project chat attachments, and comment deletion.


### Environment variables

Set these in Vercel Project Settings → Environment Variables. Keep all of them server-side only; none should use a `NEXT_PUBLIC_` prefix.

Required for production:

```env
DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/DATABASE?schema=public"
PROJECT_CHAT_STORAGE_PROVIDER="vercel-blob"
BLOB_READ_WRITE_TOKEN="your-vercel-blob-read-write-token"
```

Recommended production controls:

```env
PROJECT_CHAT_BLOB_PREFIX="project-chat"
SIGNUP_ENABLED="false"
GUEST_LOGIN_ENABLED="false"
```

`SIGNUP_ENABLED` and `GUEST_LOGIN_ENABLED` default to enabled when omitted. Leave them enabled only if public account creation and public guest workspaces are intentional for the hosted environment.

### Migrations and build command

Vercel's Build Command should be:

```bash
npm run vercel-build
```

The script validates Prisma, generates the client, applies pending production migrations with `prisma migrate deploy`, and then runs `next build`. Run the same command from a trusted machine or CI environment before the first production deployment if you want to separate migration execution from Vercel's build step.

Do not use `prisma migrate dev`, `prisma migrate reset`, or destructive reset commands against production. Verify the migration chain once against a separate empty PostgreSQL database before connecting the first real hosted database.

### Guest accounts and public signup

Guest sessions create durable `User` rows with `isGuest=true` and data scoped by the guest session cookie. This is useful for demos but can grow the production database without an approval step. For private or cost-controlled deployments, set:

```env
GUEST_LOGIN_ENABLED="false"
SIGNUP_ENABLED="false"
```

When disabled, the login page hides the guest entry point and server actions reject guest creation; the signup page also hides the signup form and rejects direct signup submissions. Existing users can still log in.

### Storage provider

Use Vercel Blob for production Project Chat attachments. Local storage writes to `public/uploads/project-chat`, which is fine for local development but not durable on Vercel serverless deployments. Vercel Blob stores public attachment URLs; anyone with an attachment URL can access that file. Use this only for attachments that may be public-by-link, or plan a future auth-protected download route/signed URL flow before storing sensitive files.

### Security risks to review

- Public signup and guest mode are intentionally available by default for demos; disable them with the environment variables above unless the Vercel deployment is meant to be open.
- Authentication uses HTTP-only, `sameSite=lax`, production-secure cookies and server-side sessions, but there is no built-in IP/user rate limiting for login, signup, guest creation, or attachment upload endpoints. Add Vercel WAF/rate limits or an application limiter before public launch.
- Project Chat attachment validation limits extension and size, but files are served from public Vercel Blob URLs. Do not use the current storage flow for confidential files without adding protected downloads.
- Do not run `npm run seed` against production unless you intentionally want the demo account and sample data from `prisma/seed.ts`.
- Keep `.env`, `.env.local`, Vercel database URLs, and Blob tokens out of Git. This repository intentionally commits only `.env.example` with placeholders.

### README and runbook status

The README now documents the Vercel environment variables, production build command, migration flow, guest/public signup controls, storage-provider choice, and known security follow-ups. Re-run this audit after adding any new external service, background job, file storage mode, or authentication provider.
