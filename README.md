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

## Deployment readiness notes

- The app is not fully deployment-ready until project chat attachments are moved away from local `public/uploads/project-chat` storage to durable hosted storage.
- Fresh production migration baseline still needs verification if the migration folder lacks an initial base-table migration. The current migrations should be reviewed against an empty hosted database before relying on `prisma migrate deploy` in production.
- Keep `.env`, `.env.local`, and any other real secret files out of Git. This repository intentionally commits only `.env.example` with placeholder values.
