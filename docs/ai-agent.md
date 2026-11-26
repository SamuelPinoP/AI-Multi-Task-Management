# The AI agent

How the in-app assistant works and why it was built this way. Scope and status live in the issues: the AI epic [#256](https://github.com/SamuelPinoP/AI-Multi-Task-Management/issues/256) and the paid-plans epic [#432](https://github.com/SamuelPinoP/AI-Multi-Task-Management/issues/432) with their sub-issues. When this page and an issue disagree, the issue wins.

The MCP server that shares the agent's tools, GitHub on tasks, Linear and Jira imports and Neon's CU-hours are planned in epics #476, #485, #492 and #495.

## What it does

A chat agent inside the app that turns plain requests into finished work, always confirmed by the user before anything changes:

- **Tickets the professional way:** "create a ticket that does X" becomes a ticket with the sections of `AGENTS.md`, "Issues": context, testable acceptance criteria and an estimate.
- **Estimates:** every task the AI creates gets one.
- **Multi-step actions:** "create a project called Whitewall with a ticket about security and a deadline on the 17th" previews a project, tickets and a calendar entry; one click creates them all.
- **Times and repeats:** "every Tuesday and Thursday at 10:00" stores the time and the repeat exactly.

What matters is the engineering around the model: validated tool calls, safety, tests and measured accuracy, not a flashy chat UI.

## How it works

- **Route and provider:** `POST /api/agent/chat` streams JSON lines (`ChatEvent` in `src/lib/ai/chat.ts`); `POST /api/agent/notice` records agreement to the data notice; `GET /api/agent/status` gives the allowance. Providers sit behind one interface in `src/lib/ai/providers/`; the loop is `src/lib/ai/agent-loop.ts`, configuration `src/lib/ai/config.ts`.
- **Where it shows:** an AI bar at the bottom of every page (Ctrl J), a pinned sidebar entry, and the `/ai` page with a resizable chats list. Minimize and hide are saved per account (`User.aiDock`).
- **History:** each person keeps their last 20 chats of up to 40 messages, deleted after 90 days unopened (`src/lib/ai/chat-history.ts`, `chat-history-core.ts`, routes in `src/app/api/agent/chats/`). Only whole exchanges are stored, and the browser sends only the question: the server builds the model's history from the database.
- **Actions:** write tools only add steps to the answer's proposal, stored for an hour in `AgentProposal`; Apply and Cancel routes run it after the person ticks what to apply on the card. Each write tool has a *plan* half and an *apply* half, built on `src/lib/*-writes.ts`, so the MCP server can reuse them (there, the client's own approval prompt is the confirmation). The agent can't change or delete events, notes, goals or projects, and says so.
- **Tickets:** the model fills a typed ticket (`create_ticket`, validated with Zod); the server writes it into the task's description; the person edits the draft before Apply; the task's page shows it in sections. Markdown renders with `react-markdown` and `remark-gfm`, raw HTML off.
- **Estimates:** an Estimate section in the description, one of nine fixed steps from 15 min to 1 week, marked "AI estimate" until a person edits it. Work over 2 days comes with 2 to 5 suggested subtasks, each with an estimate, unticked on the card. Subtasks follow their parent: they get an estimate when it has one. There is no estimate column and nothing on task rows.
- **Numbers:** a `task_stats` tool computes counts and percentages in code, and the model repeats them.
- **Not for guests:** the AI needs an account, and only people who agreed to the data notice.

## Decisions

| Question | Decision | Why |
|---|---|---|
| Where the agent lives | A TypeScript route inside the Next.js app. | Tools call the app's own logic and permission checks directly, there's one deploy, and the evaluations run the code that ships. A separate service would add an HTTP hop and a second sign-in check for every tool call, and a free host that sleeps. |
| Business model | A 40-day free trial per account, then a monthly subscription (#432). Free tiers until the flip; after that, the AI runs on a paid tier priced into the plans. | Paying customers' data can't go to a free tier, and a cheap paid model costs cents per user. |
| Model | The beta runs on Gemini 3.1 Flash-Lite's free tier. At the paid flip, gpt-oss-120b on Groq becomes the default (#502's scores; #505 makes the switch). No model picker for users. | One provider interface makes switching a configuration change. A picker would multiply what has to pass the evaluations, make the allowance depend on the model, and name more data processors in the Privacy Policy. |
| Claude | No Anthropic SDK, and Claude never runs live: the owner pays no API credits. The provider is plain `fetch`, unit tested only, with the key variable `CLAUDE_API_KEY`, never `ANTHROPIC_API_KEY` (Claude Code reads that one). | Free only. |
| Evaluation-only providers | Anthropic and Groq run locally for evaluations only. Vercel refuses them (`evaluation_provider` in `src/lib/ai/config.ts`, and the deploy-env check) until the privacy notice names them. | Every model that sees users' data has to be named in the Privacy Policy. |
| Rotating free tiers across providers | Not doing. | Limits are per account or project, free tiers use the data for training, and free models come and go. |
| Users' own keys | Not doing. | The subscription pays for capacity; asking paying customers for an API key is unusual outside developer tools. |
| Local or in-browser model | Optional privacy mode after launch only (#312). | Big downloads and capable devices, and small models are weaker at multi-step actions. |
| Hosting | Stay on Vercel; move to Pro at the flip, starting with its free 14-day trial. | Hobby is non-commercial only, and moving hosts costs days of work. |
| Task times and repeats | Wall-clock times, like event times, and custom repeats as a subset of iCalendar's RRULE. The server writes the rule from a typed object, never the model, and there's no `rrule` package. | One time convention in the app; `rrule` hasn't had a release since November 2023. |
| Age | 18 and older (`MINIMUM_AGE` in `src/lib/legal.ts`). | Gemini's terms don't allow apps likely to be used by people under 18. |
| Gemini API (#307) | `streamGenerateContent` over plain `fetch`, with `store: false`; no SDK. | `generateContent` is stateless and fully supported, and its tool-calling contract, including thought signatures, is well documented. Moving touches only `src/lib/ai/providers/gemini.ts`. |
| Caps' day (#307) | Midnight to midnight Pacific time. | Gemini resets its daily quotas then, so the app-wide cap counts the same day as Google. |
| Free-tier regions (#307) | While `AI_FREE_TIER` is on (the default), people in the EEA, Switzerland and the UK get the planner, never Gemini (`src/lib/ai/region.ts`, outcome `REGION`). `AI_FREE_TIER="false"` with a paid key lifts it. | Gemini's terms allow only paid services for users there. |
| Where the AI lives in the app (#308) | An AI bar on every page, a pinned sidebar entry, and a conversation-first AI page. No chips anywhere, and nothing more on the Tasks page. | The owner's picks: it should be quiet, the classic chat layout, no full width. |
| Send-button color (#308) | A two-tone fade in the person's accent with a white arrow. | Every tone keeps at least 3:1 against the arrow, the WCAG minimum for buttons. |
| Chat history (#452) | 20 chats, 40 messages each, deleted after 90 days unopened; whole exchanges only. | It fits Neon's free 1 GB (at most about 240 KB per person). A reopened chat never shows half an answer, and the server decides what the model sees. |
| Actions (#310) | The model only proposes; the person ticks what to apply, and the code applies it. A proposal lasts an hour. | Confirmation is enforced in code, whatever the model says. |
| Estimates (#434, #540) | Every task the AI creates gets one, shown in the draft and on the task's page, never in lists; subtasks follow their parent; any other task gets one from an Estimate button; no estimates for many tasks at once. | The owner's rules. |
| Progress answers (#453) | `task_stats` computes counts and percentages in code. | Small models get arithmetic wrong. |
| Names | "Work Agent" for the agent; the bar says "Ask AI Multi". | "Ticket Agent" is too narrow: it also handles the calendar, projects, notes and goals. |

## Rules for this work

- **Free until the flip.** No billing accounts, paid keys or paid services. Keep the AI's caps inside Gemini's free tier.
- **Nothing commercial in production before the flip.** While billing is off, no page shows a price, a trial countdown or a Subscribe button, not even a disabled one. Billing code ships behind its switch, absent rather than disabled, and is tested locally or on protected previews with test-mode keys only. Payment tests use a local stand-in for the provider (like `tests/e2e/github-stub.ts`), never a real card.
- **Tool schemas are defined once:** each tool's input is a Zod schema, used both to describe the tool to the model and to validate its arguments. Invalid arguments never reach the database. Optional arguments go through `optionalArgument` (`src/lib/ai/tools/define.ts`), so "" and null count as left out, in the schema the model sees and in the tool: Groq refuses a call its schema doesn't allow (#504). A unit test checks every tool.
- **Shared rules:** tools call the same logic and permission checks as the API routes (`src/lib/*-writes.ts`). The user ID comes from the session, never from the model.
- **Bounded loop:** a cap on tool steps and time per request, clear messages on provider errors and 429s, per-user and app-wide caps, and a usage log of runs (tokens, latency, outcome).
- **Stored text is data:** task titles, notes and other content are data, not instructions. Confirmation is enforced in code. Bulk and destructive changes list exactly what will change.
- **Ask, don't guess:** relative dates resolve in the user's time zone, and the agent asks a clarifying question when a request is ambiguous.
- **Send models as little as possible.** On Gemini's free tier Google may use what's sent, human reviewers may read it, and the terms say not to send personal information. So send only what a request needs, never whole workspaces; send nothing from someone who hasn't agreed to the data notice; and any PR that changes what's sent updates the Privacy Policy's AI section and `LEGAL_LAST_UPDATED`.
- **Keys stay on the server:** every new env var goes in `.env.example` and `scripts/validate-deployment-env.mjs`. The owner enters every key; never ask for one in chat, and never set `ANTHROPIC_API_KEY` as a permanent variable.
- **Tests use a fake provider,** so CI never calls a live model.
- **The tool registry** lets new tools be added without changing the agent loop.

## Evaluations

The cases are JSON in `src/lib/ai/evals/cases/` over a sample workspace, scored by `npm run agent:eval -- --provider <reference|gemini|anthropic|groq>`. The reference replay runs in CI with the unit tests; results are saved in `src/lib/ai/evals/results/<date>-<model>.json`.

- Live runs are by hand, never in CI, and only the owner runs them: they use his keys.
- A change to the prompt, tools, provider or model runs them before and after, and the PR explains any case that now fails. [`CONTRIBUTING.md`](../CONTRIBUTING.md#changing-the-ai-assistant) has the steps and how to add a case.
- When the agent gets something wrong, add a case first.

## Free-tier facts

- **Gemini free tier:** the pool is per project and shared by every user. Developers saw about 15 requests a minute and 500 a day on 3.1 Flash-Lite; Google no longer publishes the numbers. That is roughly 12 heavy users (20 actions a workday) or 50 typical ones.
- **Gemini free-tier terms:** Google uses what's sent, and human reviewers may read it. "Do not submit sensitive, confidential, or personal information." Apps for users in the EEA, Switzerland and the UK may use only paid services.
- **Vercel Hobby** is for non-commercial use, and Vercel may pause a deployment that advertises a paid service: the risk is a paused app, not a bill.
