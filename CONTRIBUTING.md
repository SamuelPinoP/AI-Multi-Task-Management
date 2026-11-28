# Contributing

The full house rules are in [`AGENTS.md`](AGENTS.md), for people and AI coding agents alike. The deep guides are in [`docs/`](docs).

## Set up

You need Node 24 and PostgreSQL. Copy `.env.example` to `.env`, then:

```
npm ci
npx prisma generate
npx prisma migrate deploy
npm run dev
```

[docs/development.md](docs/development.md) covers worktrees, [docs/database.md](docs/database.md) databases and migrations.

## Flow

1. **Start from an issue.** Open one from a template (bug, feature, chore or epic). Each issue has acceptance criteria, labels for type, area and priority, and an owner. Large work is an epic with sub-issues. The [roadmap project](https://github.com/users/SamuelPinoP/projects/5) holds the order.
2. **One issue, one pull request.** Branch from `main`, keep the change focused, and write `Fixes #N` when the PR finishes the issue.
3. **Run the checks:** `npm run typecheck`, `npm run lint`, `npm run test:unit`, and the Playwright specs your change touches. `npm run evidence` runs them and prints the Testing evidence table ([docs/testing.md](docs/testing.md)).
4. **Describe the PR in three sections:** Description (with deploy notes), Testing evidence, and QA.
5. **Pass CI.** `main` only accepts PRs whose required checks pass: lint, types, unit tests and build; Playwright; and the Vercel preview ([docs/ci-and-deploys.md](docs/ci-and-deploys.md)).
6. **Stay free.** The app runs on free tiers (Vercel Hobby, Neon Free, Cloudflare R2, Gmail SMTP). No change may need a paid plan.

Code conventions are in [docs/conventions.md](docs/conventions.md).

## Changing the AI assistant

The assistant is scored by evaluation cases (see the README's [AI agent](README.md#ai-agent) section). Measure every change to its prompt, tools, provider or model:

1. **Before the change,** run the evaluation against the model in use and keep its results file. Set `AGENT_EVAL_API_KEY` in the terminal for that run only, never in `.env`, with a key from a project of its own, then run `npm run agent:eval -- --provider gemini`.
2. **After the change,** run it again and compare the two files: the score, the score by ability and the cost per message. Say in the PR why any case that passed before now fails.
3. **When the agent gets something wrong,** in the app or in a run, add a case that catches it before fixing it:
   - Put it in its ability's file in `src/lib/ai/evals/cases/`, with an id that starts with the ability, such as `tasks-overdue`.
   - Write the request and, under `expect`, what a good answer does: the `tools` it calls with the arguments that matter (an item's id, such as `task-plants`, or a ref to an item the same answer creates, such as `new-1`, counts as that item's title or name), the `facts` it states, with or without Markdown emphasis such as `*Deep Work*` (a list when the wording may vary, such as `["3", "three"]`), and what it must not do (`notTools`, `notFacts`, `notPatterns`). Add `asks` when it should ask a question back, and `outcome` when it should end some other way. `@cant`, `@declines` and `@notFound` stand for common ways to say those things; `@doneClaims` catches claims of a change.
   - For a change it should propose, list it under `proposal`. For a ticket, give that change a `ticket`: the `sections` it must have, in order, `minCriteria`, `minQuestions`, and `notInvented`, where `@inventedFacts` catches dates, amounts, percentages and time limits the request didn't give. Give a new task, a ticket or not, an `estimate` range, `min` and `max`, in the fixed steps (`15 min` to `1 week`), never one step, or `false` for a subtask that must have none because its parent has none, and `split` when it must, or mustn't, offer subtasks that split it.
   - Use `history` for a follow-up, `clock` for another time zone, and `setup` for a used-up cap, the person's country or a provider failure.
   - For the estimate request (#540), put the case in `estimates.json` with an `estimate` in place of a chat: `kind` is `button` (the Estimate button: the task and its subtasks without an estimate) or `follow` (a task with an estimate passing it on, to each subtask without one, or only to those marked `added`), then the `task` and its `subtasks`, each with its `title` and its `description` as stored. Under `expect.estimates`, give the task's range (the button only) and each subtask's in order, or `false` for one that gets none. The `request` says in words what the person did, and the reference is one `estimate_tasks` call.
   - Add a `reference`: the tool calls and answer a good model would give. The unit tests replay it, and each fact (one of its wordings, for a list) must appear in what the tools return, so no case expects something the workspace doesn't say.
   - When the sample workspace lacks something, add it to `src/lib/ai/evals/workspaces/main.json`, then check that every case still passes.
   - Run `npm run agent:eval -- --provider reference --case <id>`, then `npm run test:unit`.
4. **Live runs are by hand, never in CI.** A full run is about 130 model requests and paces itself under the free plan's limits.

The repository is public. Never commit or post secrets, `.env` files or personal data.
