# Contributing

The full house rules are in [`AGENTS.md`](AGENTS.md), for people and AI coding agents alike. In short:

1. **Start from an issue.** Open one from a template (bug, feature, chore or epic). Each issue has acceptance criteria, labels for type, area and priority, and an owner. Large work is an epic with sub-issues.
2. **One issue, one pull request.** Branch from `main`, keep the change focused, and write `Fixes #N` when the PR finishes the issue.
3. **Describe the PR in three sections:** Description (with deploy notes), Testing evidence, and QA. `npm run evidence` runs the checks and prints the Testing evidence table.
4. **Pass CI.** `main` only accepts PRs whose required checks pass: lint, types, unit tests and build; Playwright; and the Vercel preview. See the README's [Testing](README.md#testing) section to run them locally.
5. **Stay free.** The app runs on free tiers (Vercel Hobby, Neon Free, Cloudflare R2, Gmail SMTP). No change may need a paid plan.

## Changing the AI assistant

The assistant is scored by evaluation cases (see the README's [AI agent](README.md#ai-agent) section). Measure every change to its prompt, tools, provider or model:

1. **Before the change,** run the evaluation against the model in use and keep its results file. Set `AGENT_EVAL_API_KEY` in the terminal for that run only, never in `.env`, with a key from a project of its own, then run `npm run agent:eval -- --provider gemini`.
2. **After the change,** run it again and compare the two files: the score, the score by ability and the cost per message. Say in the PR why any case that passed before now fails.
3. **When the agent gets something wrong,** in the app or in a run, add a case that catches it before fixing it:
   - Put it in its ability's file in `src/lib/ai/evals/cases/`, with an id that starts with the ability, such as `tasks-overdue`.
   - Write the request and, under `expect`, what a good answer does: the `tools` it calls with the arguments that matter, the `facts` it states (a list when the wording may vary, such as `["3", "three"]`), and what it must not do (`notTools`, `notFacts`, `notPatterns`). Add `asks` when it should ask a question back, and `outcome` when it should end some other way. `@cant`, `@declines` and `@notFound` stand for common ways to say those things; `@doneClaims` catches claims of a change.
   - For a change it should propose, list it under `proposal`. For a ticket, give that change a `ticket`: the `sections` it must have, in order, `minCriteria`, `minQuestions`, and `notInvented`, where `@inventedFacts` catches dates, amounts, percentages and time limits the request didn't give.
   - Use `history` for a follow-up, `clock` for another time zone, and `setup` for a used-up cap, the person's country or a provider failure.
   - Add a `reference`: the tool calls and answer a good model would give. The unit tests replay it, and each fact (one of its wordings, for a list) must appear in what the tools return, so no case expects something the workspace doesn't say.
   - When the sample workspace lacks something, add it to `src/lib/ai/evals/workspaces/main.json`, then check that every case still passes.
   - Run `npm run agent:eval -- --provider reference --case <id>`, then `npm run test:unit`.
4. **Live runs are by hand, never in CI.** A full run is about 120 model requests and paces itself under the free plan's limits.

The repository is public. Never commit or post secrets, `.env` files or personal data.
