# Contributing

The full house rules are in [`AGENTS.md`](AGENTS.md), for people and AI coding agents alike. In short:

1. **Start from an issue.** Open one from a template (bug, feature, chore or epic). Each issue has acceptance criteria, labels for type, area and priority, and an owner. Large work is an epic with sub-issues.
2. **One issue, one pull request.** Branch from `main`, keep the change focused, and write `Fixes #N` when the PR finishes the issue.
3. **Describe the PR in three sections:** Description (with deploy notes), Testing evidence, and QA. `npm run evidence` runs the checks and prints the Testing evidence table.
4. **Pass CI.** `main` only accepts PRs whose required checks pass: lint, types, unit tests and build; Playwright; and the Vercel preview. See the README's [Testing](README.md#testing) section to run them locally.
5. **Stay free.** The app runs on free tiers (Vercel Hobby, Neon Free, Cloudflare R2, Gmail SMTP). No change may need a paid plan.

The repository is public. Never commit or post secrets, `.env` files or personal data.
