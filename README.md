# AI Multi

Live Demo: https://ai-multi-task-management-vercel.vercel.app

AI Multi is a full-stack productivity and collaboration platform built with Next.js, TypeScript, Prisma, PostgreSQL, and Vercel. It supports authentication, notes, tasks, events, projects, Kanban project boards, project chat, file uploads, invitations, password reset, search, trash, planning views, recurrence, guest mode, and dark mode.

## Key Features

- Secure authentication with signup, email confirmation, login, logout, sessions, and password reset
- Notes, tasks, events, projects, calendars, a rule-based Smart Daily Planner, and trash recovery
- Project-specific Kanban boards for organizing tasks by status with read-only Viewer access and Owner/Editor task creation and movement
- Project collaboration with invitations and role-based Owner, Editor, and Viewer access enforced server-side
- Project chat with file attachments using local, Vercel Blob, or private AWS S3 storage
- A sidebar where each project opens to its Overview, Board and Chat, with unread chat counts
- A Chats page with every project chat in one place, unread first, synced across devices
- An installable app (phones and desktops) that keeps the pages you've opened readable offline
- Project templates (Capstone, Sprint, Job search) and simple automations, such as emailing the owner when a task is done
- A linked GitHub repository per project, and read-only share links for a project's roadmap

## Project chat attachment storage

Route uploads with `PROJECT_CHAT_DEFAULT_STORAGE_PROVIDER` and
`PROJECT_CHAT_VIDEO_STORAGE_PROVIDER`. For production, ordinary files can use
`vercel-blob` while validated video extensions use private `aws-s3`; local/local
is the normal development configuration. Each attachment records its provider
and key, so later configuration changes do not change where it is read or deleted.

The deprecated `PROJECT_CHAT_STORAGE_PROVIDER` remains a fallback. An explicit
default or video variable wins for its category; otherwise the legacy value is
used, then the video provider falls back to the resolved default, then local is
the final development default.

- `local` writes to `public/uploads/project-chat` and is intended only for local development.
- `vercel-blob` uses `BLOB_READ_WRITE_TOKEN` and optional `PROJECT_CHAT_BLOB_PREFIX`.
- `aws-s3` uses a private S3 bucket. AWS configuration is required only when one routing target selects S3; static access keys remain optional because the SDK default credential provider chain supports IAM roles.

Files stored with `aws-s3` count against a storage cap: 8 GB in total
(`PROJECT_CHAT_S3_QUOTA_BYTES`) and 500 MB per user
(`PROJECT_CHAT_USER_QUOTA_BYTES`). Uploads that would pass either limit are
refused with HTTP 413, and guests can't upload unless
`PROJECT_CHAT_GUEST_UPLOADS_ENABLED="true"`.

When videos route to S3, the browser uploads them directly with a short-lived presigned PUT URL so large video bodies do not pass through a Vercel Function. S3 downloads are authorized by the existing application route before it creates a short-lived presigned GET URL (10 minutes by default). An expiring URL limits the time a copied link can access the private object; it is not a permanent public URL. See [the AWS S3 storage guide](docs/aws-s3-storage.md) for setup, security, Vercel deployment, cleanup, CORS, and cost controls.

Run storage tests with `npm run test:storage`. No test contacts AWS or needs real credentials.

To check a real bucket (AWS S3 or Cloudflare R2), run `npm run verify:storage`
with that bucket's storage variables. It uploads two tiny objects through
presigned URLs, checks that an upload of the wrong size is refused, reads one
back, checks CORS for `APP_BASE_URL`, and deletes both. Point
`DOTENV_CONFIG_PATH` at a separate env file to keep production keys out of `.env`.
- PostgreSQL database modeled with Prisma migrations
- Production deployment on Vercel with Neon PostgreSQL and server-side environment validation
- Smart Daily Planner that analyzes overdue tasks, due-today work, upcoming events, active projects, recent notes, and project follow-up signals without relying on a paid external AI service
- Dark mode and responsive UI

## Testing

```bash
npm run typecheck
npm run lint
npm run test:unit
npm run test:unit:zones
npm run test:storage
npm run test:e2e
```

`npm run test:unit:zones` runs the unit tests again with the process in
Pago Pago (UTC-11), New York, Kolkata (UTC+5:30) and Kiritimati (UTC+14), so
date code that only works in UTC fails here too. CI runs both.

`npm run test:storage` runs Node tests for project-chat attachment validation,
provider selection, S3 upload planning, provider-aware downloads/deletes, and
failure cleanup. These tests mock storage behavior and do not contact AWS.

`npm run test:e2e` starts a local Next.js dev server on port `3100` by default
and runs Playwright browser tests against it. The E2E runner forces
`PROJECT_CHAT_DEFAULT_STORAGE_PROVIDER=local` and
`PROJECT_CHAT_VIDEO_STORAGE_PROVIDER=local`, so E2E attachment tests exercise
the real upload UI without using Vercel Blob or AWS S3. Set `E2E_PORT` to use a
different local port. If you already have a server running, set
`PLAYWRIGHT_BASE_URL` to test that server instead. To test the production
build, run `npm run build` and then `npm run test:e2e` with
`E2E_SERVER_MODE=start`. Running `npx playwright test` directly starts the
server from `playwright.config.ts` instead: a dev server by default, or with
`E2E_SERVER_MODE=start` a fresh `next build --webpack` followed by
`next start`. Prefer the production build locally when a machine is slow to
hydrate pages in dev, because tests that type or click right after a page loads
can otherwise act before React is ready. Both of the config's servers use
webpack, so they also work in a git worktree whose `node_modules` is a link to
another checkout, which Turbopack refuses to compile; CI builds with Turbopack,
like Vercel. When `TZ` is set, as in CI's `TZ=UTC`, the browser runs in that
time zone too, so dates a test computes match the page's dates. (Git Bash
passes `TZ=UTC` through but drops values with a slash, such as
`America/New_York`.)

### Continuous integration

`.github/workflows/ci.yml` runs on every push to `main` and every pull request.
The first job applies all migrations to an empty PostgreSQL database, fails if
`prisma/schema.prisma` and the migrations disagree, then runs lint (no warnings
allowed), typecheck, unit and storage tests, `npm audit` for high or critical
advisories in production dependencies, and a build. The second job runs the
Playwright tests against the production build with the server in UTC, on a
desktop browser and a phone-sized one.

Every CI run records a video, a trace and screenshots of each Playwright test
and keeps the HTML report as a run artifact for 14 days; the run summary links
to it. Unzip it and open `playwright-report/index.html`, or open a `trace.zip`
at https://trace.playwright.dev.

`.github/workflows/preview-smoke.yml` runs the Playwright tests tagged
`@smoke` (`tests/e2e/smoke.spec.ts`) against each Vercel preview once it is
deployed. Previews share the production database, so smoke tests must stay
read-only: no sign-ups, sign-ins or writes. Preview URLs are behind Vercel
Deployment Protection; the workflow sends the `VERCEL_AUTOMATION_BYPASS_SECRET`
repository secret as the `x-vercel-protection-bypass` header and skips itself
when the secret isn't set. Run them locally with
`npm run test:e2e -- --grep @smoke`.

Dependabot (`.github/dependabot.yml`) opens weekly update PRs for npm packages,
with minor and patch updates grouped, and for GitHub Actions. Major versions
are skipped; security updates still arrive. `dependabot-auto-merge.yml` turns
on auto-merge for each Dependabot PR, so GitHub merges it once every required
check passes and leaves it open if one fails.

CI also fails if any `@radix-ui` package is installed in more than one version
(`scripts/check-single-radix.mjs`). Duplicate Radix copies can break a menu
inside a dialog. The `overrides` entry in `package.json` keeps Prisma Studio on
the app's Radix release; update it when Radix is updated.

On the 1st of each month, `.github/workflows/maintenance-report.yml` opens a
"Monthly maintenance check" issue assigned to the repository owner, so GitHub
sends a notification. It lists major upgrades Dependabot skips, Dependabot PRs
stuck on a failing check, `npm audit` and CodeQL findings, the Node.js
end-of-life date, and a short checklist (usage and billing dashboards). It
closes the previous month's issue. Run it any time from the Actions tab
("Run workflow").

Every 30 minutes, `.github/workflows/uptime.yml` checks production the way a
visitor would (`scripts/uptime-check.mjs`: the login page, the signed-out
redirect, and the API). If it still fails after about two minutes of retries,
it opens a "Production is down" issue assigned to the repository owner, and
closes it with a note once the site answers again. The checks don't touch the
database, so they don't use Neon's free compute hours.

## Rate limits

`src/lib/rate-limit.ts` keeps request counters in the `RateLimit` table (a
sliding window per rule, keyed by a SHA-256 fingerprint of the IP address,
email or user, so none are stored in readable form). Limits, in
`src/lib/rate-limit-core.ts`: 30 login attempts per network and 5 failed
logins per account per 15 minutes (a successful login clears the account
count), 5 sign-ups and 5 password reset requests per network per hour, 3 reset
requests per account per hour, 10 reset submissions per network per 15
minutes, 10 guest workspaces per network per hour, 30 invitations per user per
hour, 60 upload requests per user per 10 minutes and 30 automation emails
per project per hour (past that, they're skipped). Forms show "Too many …
Try again in N minutes"; API routes answer 429 with a `Retry-After` header.
The client IP is the first `x-forwarded-for` entry, which Vercel overwrites;
requests without one (local development, CI) skip the per-network limits.

## Installable app and offline reading

`src/app/manifest.ts` makes the site installable: Chrome and Edge offer
"Install app" in the account menu, and iPhones use Share → Add to Home Screen.
The service worker, `public/sw.js`, is plain JavaScript, so Turbopack and
webpack builds ship the same file. `src/components/pwa.tsx` registers it in
production builds only. It keeps a copy of each page you open and of the data
those pages load (tasks, notes, events, projects, goals), and offline it
serves those copies with an "offline" notice. Saving, signing in, uploads and
attachment downloads always go to the network. Saved copies are deleted when
you log out or open a signed-out page. Icons are drawn by
`node scripts/generate-app-icons.mjs`. Playwright blocks the service worker
except in `tests/e2e/pwa.spec.ts`, which runs against a production build.

## Project templates and automations

The New project sheet can start from a template in
`src/lib/project-templates.ts`: Capstone, Sprint or Job search. Each one adds
starter tasks (some with subtasks, some repeating weekly), its first tasks on
the board, and recurring check-ins on the calendar. Dates count from the day
the project is created, in the creator's time zone.

Owners add automations on the project page (`ProjectAutomation`, one rule of
each kind per project; the list is in `src/lib/project-automations-core.ts`):
email the owner when a task moves to Done, email the owner when a task is
added, or assign new unassigned tasks to a member. Subtasks don't trigger
rules, and owners aren't emailed about their own changes. Emails go out after
the response (`after()` in `src/lib/project-automations.ts`) through the
configured email provider.

## GitHub links and share pages

Owners can link a public GitHub repository on the project page (paste
`owner/name` or its github.com address). Members then see its latest open
pull requests and issues. `src/lib/github.ts` reads GitHub's public REST API
and keeps answers for 10 minutes in the Next.js data cache, because GitHub
allows 60 requests an hour without a token. Set the optional `GITHUB_TOKEN`
(read-only access to public repositories is enough) to raise that to 5,000.
Private repositories are refused even when a token could see them.

The owner can also turn on a read-only share link, `/share/<token>`, for an
advisor or a recruiter. It shows the project's name, description and
progress, task titles with their status and due dates, events in the next 60
days and the linked repository. Notes, chat, files, members, assignees and
task descriptions stay private. The token is 24 random bytes. "New link"
replaces it, and "Turn off" ends sharing; either way the old link answers 404.
Share pages are `noindex` and send no Referer. The project APIs never return
the token to other members.

In tests, `tests/e2e/github-stub.ts` stands in for GitHub (Playwright's global
setup, on the E2E port + 1000). `GITHUB_API_URL` points the app at it; it's
refused in production.

## Database backups

Every day at about 07:00 UTC, Vercel Cron calls `/api/cron/backup`
(`vercel.json`). It exports every table to one gzipped JSON file in the private
R2 bucket under `backups/database/` and keeps the newest 30. Login sessions,
password reset tokens and pending upload slots are left out; they're
short-lived and useless after a restore. A second call within 20 hours does
nothing, so the route is safe to leave public; set `CRON_SECRET` in Vercel to
require it anyway. Locally the backups go to `./backups/` (ignored by git).

To restore: create an empty database (for example a new Neon branch), run
`npx prisma migrate deploy` against it, then
`RESTORE_DATABASE_URL="<target>" npm run restore:database -- <backup.json.gz>`.
Add `DOTENV_CONFIG_PATH=.env.r2` and `--from-r2 latest` to fetch the newest
backup straight from R2. The script refuses targets that already have data
and checks that the target has the backup's migrations. It restores in one
transaction, so a failure leaves the target empty.

## Daily cleanup

Every day at about 09:00 UTC, after the backup, Vercel Cron calls
`/api/cron/cleanup` (`src/lib/daily-cleanup.ts`). It deletes:

- expired login sessions, used or expired password reset tokens and expired
  rate-limit counters;
- guest workspaces that started more than 30 days ago and have no valid
  session (guests have no password, so nobody can open them again), with
  their tasks, notes, events, projects and stored chat files. A guest that is
  in a real user's project, or whose project has a real member, is left alone;
- chat uploads that expired without being attached, with their stored files.

It answers with the counts. A repeat call finds nothing new, so the route is
safe to leave public; with `CRON_SECRET` set it is required, as for backups.

## Tech Stack

- Frontend: Next.js App Router, React, TypeScript, Tailwind CSS
- Backend: Next.js Route Handlers / Server Actions
- Database: PostgreSQL, Prisma ORM, pgAdmin 4
- Storage: local filesystem, Vercel Blob, or private AWS S3 with hybrid routing
- Deployment: Vercel
- Email: optional Gmail SMTP, Brevo or Resend; in-app invitations work without email

## Screenshots

### Dashboard
![Dashboard screenshot](docs/screenshots/dashboard.png)

### Projects
![Projects screenshot](docs/screenshots/projects.png)

### Project Chat
![Project chat screenshot](docs/screenshots/project-chat.png)


### Main Task Board

The app includes a dedicated `/board` productivity area linked from the main navigation as **Task Board**. It currently supports:

- **Kanban View** for organizing personal and project tasks by status across the workspace.
- **Tree View** for user-specific editable hierarchy pages, such as Warrior, Study Plan, or Career Plan, with root nodes, child nodes, sibling nodes, renaming, deletion, simple reordering, and parent changes.
- A disabled **Mindnote View** entry point so the board structure can be extended later without changing the primary navigation.

Plans for drag and drop in the Tree View, a 3D Mind View and more sidebar tools are in [docs/views-roadmap.md](docs/views-roadmap.md).
