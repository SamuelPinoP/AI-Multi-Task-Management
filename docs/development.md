# Development

How to set up, work and ship a change. The rules for issues and PRs are in [`AGENTS.md`](../AGENTS.md); tests are in [testing.md](testing.md), databases and migrations in [database.md](database.md), code conventions in [conventions.md](conventions.md), CI and deploys in [ci-and-deploys.md](ci-and-deploys.md).

## Setup

- Node 24 (`engines`), PostgreSQL, and a checkout. Copy `.env.example` to `.env` for a local database, or export CI's public placeholders from the `env:` block at the top of `.github/workflows/ci.yml` (enough with [a throwaway database](database.md#a-throwaway-database)).
- `npm ci`, `npx prisma generate` (`DATABASE_URL` must be set, since `prisma.config.ts` requires it), `npx prisma migrate deploy` ([database.md](database.md)), then `npm run dev`. Run `npx playwright install chromium` before the first e2e run and after a Playwright upgrade (tests fail in about 1 ms with "Executable doesn't exist" otherwise).
- After `npm ci`, or a checkout that changes `prisma/schema.prisma`, run `npx prisma generate` again and delete `.next`: a stale `.next/types/validator.ts` makes `tsc` fail with TS2307.

## Worktrees

Several people and agents work at once, each in their own worktree on a branch, never by switching a shared checkout's branch.

```
git fetch origin
git worktree add ../worktrees/<name> -b claude/<slug> origin/main
```

- Give every worktree a real `npm ci`. Turbopack refuses a junctioned or symlinked `node_modules`; with one, only `next dev --webpack` and `next build --webpack` work.
- Before editing a shared file (`app-shell.tsx`, `app-nav.ts`, `package.json`, `playwright.config.ts`), check whether another open branch changes it: `git merge-tree --write-tree --name-only <yours> <theirs>` shows conflicts without touching a worktree.
- If a checkout has changes you didn't make, stop and ask. Sessions started together can write into each other's worktree: check `git diff` first.
- Remove a worktree the safe way: see [Windows](#windows).

## How to work

1. **Look first.** `git fetch origin`, `git log origin/main --oneline -5`, `git worktree list`, `gh pr list`, `gh issue list`. Search open and recently closed issues and PRs for the same problem before filing or fixing (two sessions once filed one bug twice).
2. **Pick the work** (`AGENTS.md`, "Start here"). `gh project item-list 5 --owner SamuelPinoP --format json --limit 100` lists the roadmap in rank order with each item's Phase, and `gh api graphql -f query='{repository(owner:"SamuelPinoP",name:"AI-Multi-Task-Management"){issue(number:<n>){blockedBy(first:10){nodes{number state}}}}}'` shows an issue's blockers. A new issue goes on the board with `gh project item-add 5 --owner SamuelPinoP --url <issue url>`; then set its Phase and Status, place it (`updateProjectV2ItemPosition`) and link real dependencies (`addBlockedBy`), 3 to 5 changes per call. The owner's order wins.
3. **Make a worktree** (above) and build the smallest complete version, in the style of the surrounding code.
4. **Test it** ([testing.md](testing.md)): logic in a `node:test` file, flows in a Playwright spec, then `npm run evidence` on the final commit.
5. **Open the PR** ready for review: commit, `git push -u origin claude/<slug>`, `gh pr create`. The description follows `AGENTS.md`, "Pull requests". Use `Fixes #N` only when the PR completes the whole issue.
6. **Hand it over.** If `main` moved (`git merge-base --is-ancestor origin/main <branch>` fails), merge it in, re-run the evidence and update the body, so CI tests what `main` becomes. Every env var the PR needs must already be set in Vercel, or the production build fails. Then stop: the owner merges.
7. **After the merge:** check the deploy ([ci-and-deploys.md](ci-and-deploys.md#after-a-merge)), close the issues the PR finished, stop your throwaway database, and remove the worktree.

## Designs

UI work starts with a design canvas, because layouts are chosen from mockups:

- Research how professional apps do it, then show about three options per question as tappable mockups on one canvas, and recommend one. Phone and desktop go on separate boards.
- Mockups are read literally: areas that don't change look exactly as the app has them, and no captions go inside the frames.
- Full width: no white space at the sides and no stacked header rows. Lists run edge to edge, on phones too.
- For colors, settle the design first, then show it in all five accent palettes. Plain bug fixes go straight to a PR.
- Each pick becomes its own issue and PR, built with any tweak the owner adds and recorded in the issue's Decisions. A canvas-only issue changes no code: post the canvas link and an options table as an issue comment. If nothing beats the current design, say so.
- Product priority is bringing in users: guests first, sign-in as pop-ups over pages, and no text that isn't needed. A switch gets a small "?" that explains it.

## Windows

These bit people on Windows 11 with Git Bash and PowerShell:

- **Worktree removal follows junctions.** `git worktree remove` empties the target of a junction, such as a shared `node_modules`, and a built `.next` holds junctions too (`.next/node_modules/<package>-<hash>`, again under `.next/dev/`). Before removing a worktree: list links with `find <worktree>/.next -type l` and `readlink`; delete each link itself, never its target (`(Get-Item -LiteralPath '<path>').Delete()` in PowerShell); check the shared `node_modules` and `.env` still exist; then run `git worktree remove --force <path>` from the main checkout as its own command. With a real `npm ci` the `.next` links point into the worktree's own `node_modules` and need no unlinking. If removal says "Permission denied", a shell's working directory is inside the folder: move out and `rmdir` the empty folder.
- **Git Bash** rewrites arguments such as `origin/main:path` (prefix `MSYS_NO_PATHCONV=1`) and `curl -w "/…"` formats; drops `TZ` values containing a slash (set them in PowerShell or Node); collapses `\\` in `node -e`, `printf` and heredocs, where an apostrophe also ends a single-quoted `node -e '…'` (write such code to a file); and its `sed` and `grep` don't see CRs.
- **Line endings:** working copies use CRLF (`core.autocrlf=true`) while Git stores LF. A `sed` or heredoc edit can leave mixed endings: use an editor or Node.
- **Paths contain spaces:** quote them.
- **PowerShell history** (PSReadLine) skips lines containing "password", "token", "apikey" or "secret", but a line that sets a key in an environment variable is saved: clear the variable (`Remove-Item Env:<NAME>`) after use.
- **Crashes:** Windows error 3221226505 kills Playwright workers while `tsc`, ESLint or unit tests run in another worktree: run evidence for one PR at a time.
- **A server left on a port:** `netstat -ano | grep ":<port> .*LISTENING"`, then `taskkill //PID <pid> //F`.
- **Preview pane:** it reads the launch configuration of the folder it was opened in, not a worktree's, and shares cookies across every `localhost` port, so it may be signed in to another session's account. Serve on `127.0.0.1` for separate cookies, or screenshot with a throwaway Playwright script (a fresh guest each run), deleted afterwards. Never create data in an account you didn't make. Screenshots crop or time out when the emulated size is larger than the pane, or the pane is hidden; a hidden pane's page has no size until `resize_window` sets one (1280×720 works).
- **Scratch folders** can move between app restarts, leaving a throwaway database under the old root: look in both.

## Cloud sandboxes

A cloud session has no `.env`, no Vercel login and no secrets, and needs none.

- **GitHub:** `gh` goes through a proxy that refuses GraphQL, so `gh pr` and `gh issue` fail; use the REST API. With `R=repos/<owner>/<repo>`:
  - open PRs: `gh api "$R/pulls?state=open" --jq '.[] | "#\(.number) \(.head.ref): \(.title)"'`
  - open issues: `gh api "$R/issues?state=open&per_page=100" --paginate --jq '.[] | select(.pull_request == null) | "#\(.number) \(.title)"'`
  - an issue and its comments: `gh api "$R/issues/<n>"`, `gh api "$R/issues/<n>/comments"`
  - file an issue: `gh api "$R/issues" -f title="..." -F body=@issue.md -f "labels[]=type: bug" -f "labels[]=area: ..." -f "labels[]=priority: medium" -f "assignees[]=<owner>"`
  - comment: `gh api "$R/issues/<n>/comments" -F body=@note.md`; close: `gh api -X PATCH "$R/issues/<n>" -f state=closed -f state_reason=completed`
  - open the PR, ready for review: `gh api "$R/pulls" -f head=<branch> -f base=main -f title="..." -F body=@pr.md`
  - `gh workflow run`, `gh run list`, `gh run view` and `gh run download` work as usual.
- **Database:** PostgreSQL 16 is installed but stopped. Start it and create CI's user and database with CI's public placeholders:
  ```
  service postgresql start
  sudo -u postgres psql -c "CREATE USER app WITH PASSWORD 'app' CREATEDB;"
  sudo -u postgres createdb -O app app_test
  export DATABASE_URL="$(sed -n 's/^  DATABASE_URL: //p' .github/workflows/ci.yml)"
  npm ci && npx prisma generate && npx prisma migrate deploy
  npx playwright install --with-deps chromium
  ```
  If a download is blocked, name the checks you couldn't run in the PR's Testing evidence; CI runs every check on every push.
- **Deploys:** there is no Vercel MCP and no Vercel login. A merge's production deploy shows on GitHub (see [ci-and-deploys.md](ci-and-deploys.md#after-a-merge)). If the network blocks the production URL, say that `/` and `/login` weren't checked. A red "Vercel" check's build log needs a local session.
- **The sandbox pauses between turns** and can lose uncommitted changes: commit and push to your `claude/` branch after each step.
