# Testing

What to run, and the traps that waste time. The README's [Testing](../README.md#testing) section describes what each suite covers; [database.md](database.md) sets up a database.

## Commands

```
npm run typecheck
npm run lint
npm run test:unit        # node:test files listed in package.json
npm run test:unit:zones  # the unit tests again in four time zones; CI runs both
npm run test:storage
npm run test:e2e         # Playwright; E2E_SERVER_MODE=start tests the production build
npm run test:visual      # screenshot comparison; references are made on Linux in CI
npm run evidence         # the PR's testing-evidence table (see below)
npm run agent:eval -- --provider reference   # the AI evaluations' replay; see docs/ai-agent.md
npx next build
```

`npm run verify:storage` checks the live storage bucket and needs production keys: only the owner runs it.

## Writing tests

- **Logic:** a `node:test` file next to the code, added to the `test:unit` script. Date code also passes `npm run test:unit:zones`.
- **Flows:** a Playwright spec in `tests/e2e/`. New pages go in the page list of `tests/e2e/accessibility.spec.ts`; a phone spec goes in the phone project's `testMatch` in `playwright.config.ts`.
- **Production build:** run e2e against one, because a busy dev server loses clicks before hydration: `npx next build`, then `E2E_SERVER_MODE=start E2E_PORT=31xx node scripts/run-playwright-e2e.mjs <specs>` with `DATABASE_URL` set and `TZ=UTC` like CI. The runner doesn't build. In a cloud sandbox, set `E2E_CHROMIUM_PATH` ([development.md](development.md#cloud-sandboxes)).
- **Evidence:** on the final commit, alone, run `npm run evidence` and paste its table into the PR. `-- --build` adds the production build; `-- --e2e <specs>` builds and runs those specs (every spec without names). Say that CI runs every spec on every push.
- The e2e server always runs with `EMAIL_PROVIDER=disabled`, and previews run with Preview's variables, so `@smoke` tests must hold whether a switch such as `GUEST_LOGIN_ENABLED` is on or off.

## e2e traps

- Every test timing out at the first heading ("Good morning") means the database is down. Check `pg_isready`.
- "Cannot find module …\.next\server\app\page.js" means a missing or stale build. A local `next start` can die mid-run (`ERR_CONNECTION_REFUSED` on every remaining test), and the first test or two on a cold server can flake: re-run before suspecting the change.
- Two runs at once need `E2E_PORT`s at least 2 apart, and clear of each other's +1000 and +1001 (the stub servers).
- Measure boxes only after transitions end: the sidebar narrows over 200 ms, so wait for the end state, for example `expect.poll` on `#app-sidebar`'s width.
- Headless Chromium hides scrollbars, so a bug caused by a scrollbar's width (15 px on Windows) passes. Show them with `test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } })` at the top of the spec, as `message-boxes.spec.ts` does; it starts its own browser, so it can't go inside a `describe`.
- An "it's gone" check proves nothing while a modal is open: Radix hides the rest of the page from `getByRole`, so `toHaveCount(0)` passes at once. After confirming in a dialog, wait for the toast or the dialog closing; prove a race by holding the request with `page.route()`.
- Wait for what the browser shows (a toast, a heading), not the server's state. React's hidden streaming copy can duplicate text: assert on visible text.
- `page.route()` doesn't catch where a redirect goes next: after Allow's 303, the browser dialed the routed loopback address for real and showed an error page (`ERR_CONNECTION_REFUSED`, `chrome-error://chromewebdata/`). Serve such a stop for real, as `oauth.spec.ts` does on a port the system picks.
- Scope ambiguous lookups: two "Chat" links appear when the sidebar shows a project's pages (look inside `#main-content`); scope Calendar to the "Workspace" navigation; use `exact: true` for button names (tree handles are "Move <title>"); attachments are `input[type="file"][multiple]`.
- On phones the profile menu opens from the top bar, or inside the menu sheet on pages without one: use `openAccountMenu()` from `tests/e2e/helpers.ts`.
- End date patterns such as `^Sun, Nov 1` with `\b`, or they match "Sun, Nov 15". Tests comparing event times with "now" run the browser in an `Etc/GMT±N` zone where it's midday ("Now and next" in `home.spec.ts`).
- `signUpAndLogIn` marks the email confirmed; pass `{ confirmEmail: false }` for an unconfirmed user and `{ name }` for a fixed name.
- Changing words the UI shows can break an older test that asserts them: search `tests/` for the old words first. Chat search shows results beside the chat only at about 1440 px or wider.
- Watching a run's log: Playwright's list reporter prints a failure as `  x  12 [mobile] › …`, two spaces first, so match `^\s+x\s`. `npm run evidence` prints its E2E row only when the run ends.
- CI retries a failed test once. A test that passes only on retry shows "N flaky" in the run summary: treat it as a bug, open an issue and fix the race.
- Every e2e server logs `pg`'s DeprecationWarning "Calling client.query() when the client is already executing a query", from Prisma, on `main` too. It breaks only in `pg` 9 (unreleased): find the caller with `--trace-deprecation` before upgrading.

## Visual references

The screenshots in `tests/visual` are compared with references made on Linux in CI (`visual.yml`, "Visual regression (not required)").

- A **page change** fails it until new references exist. Push, and let the PR's own failing run finish: its report is the before and after. Then `gh workflow run visual.yml --ref <branch> -f update=true`, download the `visual-screenshots` artifact into an empty folder, and commit only the images your change touches beyond noise.
- A sidebar or app-shell change alters every desktop reference.
- A mask is the masked element's box, so over text sized by random data it changes between runs (the phone image's 0.1% limit is about 345 px). Mask a fixed-size container or fix the data (the visual accounts are all "E2E visual").
- A tool that counts every differing pixel is stricter than `toHaveScreenshot`, which ignores differences within its color threshold: check an image near the limit with Playwright's own comparison before calling it a failure.
- `task-sections-phone` shows tomorrow's date, so it drifts a little every day.
