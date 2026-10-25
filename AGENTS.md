# House rules

Rules for everyone who works in this repository, people and AI coding agents alike. `CLAUDE.md` loads this file for Claude Code; other agents read it directly.

## Pull requests

Every pull request description follows [`.github/pull_request_template.md`](.github/pull_request_template.md), in this order: **Description**, **Testing evidence**, **QA**. GitHub fills the template in for PRs opened on the website; with `gh pr create --body-file`, start from the template yourself. AI agents write all three sections without being asked (#231).

Give the PR a title that says what changes for the user, in plain words.

### 1. Description

- What changed and why, in words someone who doesn't read the code can follow.
- The issue: `Fixes #N` only when the PR finishes the whole issue, otherwise `Part of #N`.
- Screenshots or a short video for visible changes, desktop and phone.
- **Deploy notes**, one line each, writing "None" rather than leaving a line out:
  - Migration: what it adds. Migrations stay additive.
  - New env vars: each one, and whether it's set in Vercel. The production build fails without them.
  - Free-tier cost: extra requests, polling, storage or emails, measured against the free plans (Vercel Hobby, Neon Free, Cloudflare R2, Gmail).
  - Rollback: "Revert this PR", or what else it takes (for example, a migration that stays behind).

### 2. Testing evidence

Every automated check you ran on the PR's final commit, with its numbers.

- Run `npm run evidence` and paste the table it prints. It runs lint, typecheck (`tsc --noEmit`), unit tests in UTC and four more time zones, storage tests and the Radix check, and counts files, rules and tests for each.
  - `npm run evidence -- --build` adds the production build.
  - `npm run evidence -- --e2e tests/e2e/<name>.spec.ts ...` builds, then runs those Playwright specs against the build with `TZ=UTC`, like CI. `--e2e` alone runs every spec. Set `E2E_PORT` when port 3100 is taken.
- Copy the numbers; never round or guess them.
- Name anything you didn't run and why (for example, "E2E: only the 3 specs this touches; CI runs all of them").
- If a later commit changes the code, run it again and update the table.

### 3. QA

The steps a person takes in the app to see that the PR works, each with what it proves. QA comes last.

- Write each step as actions, the result to expect, and what that proves:
  - [x] In the sidebar, click **+** next to Projects, name the project "QA test" and click **Create project**. "Project created" shows, and the project opens and appears in the sidebar. *Proves projects can be created.*
  - [x] On the Projects page, open "QA test"'s **More actions** menu, click **Delete**, then **Delete project**. It disappears from the page and the sidebar. *Proves projects can be deleted.*
- Cover the main path, at least one edge case or error, and the phone layout when the UI changed.
- Tick the steps you carried out yourself and say where: a local production build or the Vercel preview. Leave the rest unticked for the reviewer. Never sign in or create data on production.
- When nothing in the app changes (CI, docs, scripts), give the steps that show the change works instead.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
