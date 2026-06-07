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

### Hosted deployment

For Vercel or another hosting provider, create a hosted PostgreSQL database with Neon, Supabase, Railway, or a similar provider. Add the production connection string as a server-side environment variable in the hosting provider settings:

```env
DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/DATABASE?schema=public"
```

Do not commit hosted credentials to Git. Do not expose database credentials to browser code, and do not name this variable with a `NEXT_PUBLIC_` prefix.

Before or during production deployment, run Prisma generation and apply production migrations:

```bash
npx prisma validate
npx prisma generate
npx prisma migrate deploy
npm run build
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

## Deployment readiness notes

- The app is not fully deployment-ready until project chat attachments are moved away from local `public/uploads/project-chat` storage to durable hosted storage.
- Fresh production migration baseline has been repaired with an initial base-table migration and a final schema-alignment migration. Before the first real hosted deployment, verify it once against a separate empty PostgreSQL database using the commands above.
- Keep `.env`, `.env.local`, and any other real secret files out of Git. This repository intentionally commits only `.env.example` with placeholder values.
