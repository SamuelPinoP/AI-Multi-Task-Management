# CI and deploys

How a change gets checked and shipped, and where things run. All of it fits free tiers; check any new feature against them (see `AGENTS.md`). Prefer refreshing on focus to polling, and slow, visible-only polling to fast: any request keeps Neon awake for 5 minutes, so polling that never stops spends its CU-hours all day.

## Required checks

The "Protect main" ruleset requires a PR and three checks:

- `Vercel`: the preview deployment's build.
- `Lint, types, unit tests, build`: 15-minute limit. It also applies the migrations to an empty database, fails if `schema.prisma` and the migrations disagree, runs the unit tests in other time zones, fails if Radix UI is installed twice, and runs `npm audit --omit=dev --audit-level=high`.
- `Playwright (server in UTC)`: 45-minute limit, for a job that takes 25 to 29 minutes (#582 aims for about 15); retries a failed test once.

Head branches are deleted on merge. Loosening a check needs the owner's OK. Dependabot's minor and patch PRs auto-merge once green; majors are skipped and listed in the monthly maintenance issue. A Radix bump needs the `overrides` entry for `@radix-ui/react-toggle` in `package.json` to match.

Not required:

- `visual.yml`, "Visual regression (not required)": screenshots on every PR and push to `main` ([testing.md](testing.md#visual-references)).
- `preview-smoke.yml`: the `@smoke` tests plus Lighthouse on `/`, `/login` and `/signup` (accessibility below 95 fails), on every preview.

## Deploys

- Production runs on Vercel Hobby (non-commercial use only; 1M function calls and 4 hours of active CPU a month) with Node 24. Every merge to `main` deploys with `npm run vercel-build`: env validation, `prisma validate` and `generate`, the deploy migrations, then `next build` (Turbopack). Every PR gets a preview deployment.
- **Deploy migrations:** `scripts/migrate-deployment-database.ts` runs `prisma migrate deploy` in production and preview builds. Production skips it when the record in R2 shows every migration already applied (`ALWAYS_RUN_MIGRATIONS=true` forces it). Prisma's CLI uses `DATABASE_URL_UNPOOLED` (`PREVIEW_DATABASE_URL_UNPOOLED` on previews), because its advisory lock outlives a pooled session; the app keeps the pooled URL.
- **Env vars:** every variable a change needs must be set in Vercel before the merge, or the production build fails (`scripts/validate-deployment-env.mjs` lists them). The owner enters every secret.

## Where things run

- **Databases:** production is Neon through Vercel Storage (Free: 1 GB and 100 CU-hours a month). Previews have their own Neon database (`PREVIEW_DATABASE_URL`), migrated by every preview build; keep `@smoke` tests read-only anyway. Local is whatever `DATABASE_URL` points at.
- **File storage:** production uses a Cloudflare R2 bucket (8 GB in total, 500 MB per user, no uploads for guests). It also holds backups, calendar feeds and the deploy-migration records. Previews and local use the `local` provider. See [aws-s3-storage.md](aws-s3-storage.md) for the S3 option.
- **Scheduled jobs:** Vercel Cron (`vercel.json`): a backup to R2 at 07:00 UTC (newest 30 kept; `npm run restore:database`), cleanup at 09:00 (also deletes guests 30 days after their last visit), due-soon reminders at 13:00. GitHub Actions: `uptime.yml` every 30 minutes (a "downtime" issue that closes itself), `maintenance-report.yml` on the 1st (a "Monthly maintenance check" issue; asking an agent to work through the latest one hands it over), `security-audit.yml` daily (one `security-audit` issue for high and critical advisories).
- **Email and sign-in:** Gmail SMTP in production (about 500 a day; Brevo is supported), disabled in Preview. Sessions and passwords are the app's own; Google sign-in, public signup and guest mode are on in Production.

## Gotchas

- **A red "Vercel" check:** read the build log first (Vercel's deployment events, or the deployment's page); don't push empty commits to retry blind. A failing preview shows only 7 or 8 checks, because smoke and Lighthouse skip without a live preview: an effect, not the cause.
- `npx playwright install --with-deps` sometimes spends over 10 minutes on apt and hits the job's limit: `gh run rerun --failed`.
- CI and deploys can start late: GitHub incidents delayed pushes by about 30 minutes, and Vercel can lag 10 to 12 minutes or skip a push (merging `main` in again retriggers it).
- **Don't poll CI.** `gh pr checks --watch` exits on a network timeout as if done. Check once, or let the app report it.
- `npm audit --omit=dev --audit-level=high` fails every PR while `main` has a high or critical advisory, even in an untouched package. The daily `security-audit.yml` files the issue; fix it with an `overrides` pin in `package.json`.
- Lighthouse records request headers, including the preview bypass secret, so `scripts/scrub-lighthouse-reports.mjs` removes it before upload. `actions/upload-artifact` skips hidden folders such as `.lighthouseci/` without `include-hidden-files: true`.

## Stacked PRs

Stack each PR on the one that merges before it. When the base merges, GitHub retargets the next PR to `main`, which runs no CI and leaves it blocked: merge `main` in, push, and re-run its evidence before the owner merges it. It is ready when `git diff --stat origin/main <head>` shows only its own files. Merging a PR before its base lands it in the base's branch.

To merge into a branch no worktree has checked out: `git merge-tree --write-tree`, `git commit-tree -p <branch> -p <other>`, then `git update-ref`.

## After a merge

1. The production deployment for the merge commit succeeded:
   ```
   gh api "repos/<owner>/<repo>/deployments?sha=<merge sha>&environment=Production" --jq '.[0].id'
   gh api "repos/<owner>/<repo>/deployments/<id>/statuses" --jq '.[0].state'   # success
   ```
2. `/` and `/login` on the production URL answer 200. Production checks stay read-only: status codes, deployment state and build logs; never sign in or create data there.
3. For a migration, the build log shows it applied.
4. Close the issues the PR finished, if GitHub didn't ([`AGENTS.md`](../AGENTS.md#issues), "Closing").
