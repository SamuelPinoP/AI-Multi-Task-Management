import { expect, test, type APIRequestContext, type Browser, type BrowserContext } from "@playwright/test";
import { AI_NOTICE_VERSION } from "../../src/lib/ai/notice";
import { continueAsGuest, queryDatabase, signUpAndLogIn, uniqueName } from "./helpers";

// The changes the AI assistant proposes (#310), end to end against the real database. The server's
// fake model (src/lib/ai/providers/fake.ts) calls every tool a message names, with the JSON after
// each name, then says what each one proposed. Nothing changes until the person who asked applies
// the proposal through its own endpoint: the changes they ticked, all of those in one transaction.
// Cancel changes nothing.

type ChatEvent = { type: string } & Record<string, unknown>;
type Link = { step: number; title: string; href: string };
type Proposal = { id: string; state: string; expiresAt: string; steps: Array<Record<string, unknown>>; applied: number[]; links: Link[]; error: string | null };

test.describe.configure({ mode: "serial" });

const contexts: BrowserContext[] = [];
let me: APIRequestContext;
let myEmail = "";
let outsider: APIRequestContext;

async function agreedAccount(browser: Browser, label: string) {
  const context = await browser.newContext();
  contexts.push(context);
  const page = await context.newPage();
  const { email } = await signUpAndLogIn(page, label);
  await page.close();
  expect((await context.request.post("/api/agent/notice", { data: { version: AI_NOTICE_VERSION } })).status()).toBe(200);
  return { api: context.request, email };
}

/** Sends one message in a new chat and reads the whole answer, one JSON object per line. */
async function ask(api: APIRequestContext, message: string) {
  const response = await api.post("/api/agent/chat", { data: { message } });
  const body = await response.text();
  expect(response.status(), body).toBe(200);
  return body
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as ChatEvent);
}

/** A message the fake model reads as these tool calls, in order. */
const calls = (...named: Array<[string, Record<string, unknown>]>) => named.map(([name, args]) => `${name} ${JSON.stringify(args)}`).join(" ");

function proposalIn(events: ChatEvent[]) {
  const found = events.filter((event) => event.type === "proposal");
  expect(found, JSON.stringify(events)).toHaveLength(1);
  return (found[0] as ChatEvent & { proposal: Proposal }).proposal;
}

const answerText = (events: ChatEvent[]) =>
  events
    .filter((event) => event.type === "text")
    .map((event) => event.text)
    .join("");

async function post(api: APIRequestContext, proposalId: string, action: "apply" | "cancel", body?: string) {
  const options = body === undefined ? {} : { data: body, headers: { "Content-Type": "application/json" } };
  const response = await api.post(`/api/agent/proposals/${proposalId}/${action}`, options);
  return { status: response.status(), body: (await response.json()) as { proposal?: Proposal | null; error?: string } };
}

async function newTask(title: string) {
  const response = await me.post("/api/tasks", { data: { title } });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

async function taskRow(id: string) {
  const { rows } = await queryDatabase<{ status: string; deletedAt: Date | null }>(`SELECT status, "deletedAt" FROM "Task" WHERE id = $1`, [id]);
  return rows[0];
}

async function proposalRow(id: string) {
  const { rows } = await queryDatabase<{ status: string; messageId: string | null; error: string | null }>(
    `SELECT status, "messageId", error FROM "AgentProposal" WHERE id = $1`,
    [id],
  );
  return rows[0];
}

test.beforeAll(async ({ browser }, testInfo) => {
  testInfo.setTimeout(120_000);
  const mine = await agreedAccount(browser, "E2E proposals user");
  me = mine.api;
  myEmail = mine.email;
  outsider = (await agreedAccount(browser, "E2E proposals outsider")).api;
});

test.afterAll(async () => {
  for (const context of contexts) await context.close();
});

test("a project, its task and its deadline: nothing changes until Apply, then all of it does, via AI Multi", async () => {
  const project = uniqueName("E2E Whitewall");
  const task = uniqueName("E2E Harden sign-in");
  const deadline = uniqueName("E2E Whitewall deadline");
  // Every task the AI creates comes with its estimate (#434), written in the task's description.
  const estimate = "## Estimate\n\n**1 day** · AI estimate\nAttempt limits and their tests.";
  const events = await ask(
    me,
    calls(
      ["create_project", { name: project, description: "Security work" }],
      ["create_task", { title: task, project, dueDate: "2026-12-17", priority: "HIGH", estimate: { size: "1 day", reason: "Attempt limits and their tests." } }],
      ["create_event", { title: deadline, date: "2026-12-17", project }],
    ),
  );
  const proposal = proposalIn(events);
  const newProject = { ref: "new-1", name: project };
  expect(proposal).toMatchObject({ state: "pending", applied: [], links: [], error: null });
  expect(proposal.steps).toEqual([
    { kind: "create_project", ref: "new-1", name: project, description: "Security work" },
    { kind: "create_task", ref: "new-2", title: task, description: estimate, dueDate: "2026-12-17", priority: "HIGH", project: newProject, parent: null },
    { kind: "create_event", ref: "new-3", title: deadline, date: "2026-12-17", startTime: null, endTime: null, description: null, project: newProject },
  ]);
  expect(answerText(events)).toContain(`Proposed: New project "${project}"`);
  // An hour to apply it, and it's linked to the stored answer.
  expect(Date.parse(proposal.expiresAt) - Date.now()).toBeGreaterThan(55 * 60_000);
  expect((await proposalRow(proposal.id)).messageId).not.toBeNull();

  // Nothing exists yet.
  const projects = async () => (await queryDatabase(`SELECT id FROM "Project" WHERE name = $1`, [project])).rows;
  expect(await projects()).toEqual([]);
  expect((await queryDatabase(`SELECT id FROM "Task" WHERE title = $1`, [task])).rows).toEqual([]);

  // Only the person who asked can apply or cancel it.
  for (const action of ["apply", "cancel"] as const) {
    const refused = await post(outsider, proposal.id, action);
    expect(refused.status).toBe(404);
    expect(refused.body.error).toBe("These changes aren't there any more.");
  }
  expect(await projects()).toEqual([]);

  // No body applies every change.
  const applied = await post(me, proposal.id, "apply");
  expect(applied.status, JSON.stringify(applied.body)).toBe(200);
  expect(applied.body.proposal).toMatchObject({ state: "applied", applied: [0, 1, 2] });

  const [created] = await projects();
  const [createdTask] = (await queryDatabase<{ id: string }>(`SELECT id FROM "Task" WHERE title = $1`, [task])).rows;
  const [createdEvent] = (await queryDatabase<{ id: string }>(`SELECT id FROM "Event" WHERE title = $1`, [deadline])).rows;
  const links = [
    { step: 0, title: project, href: `/projects/${created.id}` },
    { step: 1, title: task, href: `/tasks?task=${createdTask.id}` },
    { step: 2, title: deadline, href: `/events?event=${createdEvent.id}` },
  ];
  expect(applied.body.proposal?.links).toEqual(links);
  const { rows: tasks } = await queryDatabase<{ projectId: string; priority: string; due: string; description: string }>(
    `SELECT "projectId", priority, to_char("dueDate", 'YYYY-MM-DD') AS due, description FROM "Task" WHERE title = $1`,
    [task],
  );
  expect(tasks).toEqual([{ projectId: created.id, priority: "HIGH", due: "2026-12-17", description: estimate }]);
  const { rows: calendar } = await queryDatabase<{ projectId: string; hasStartTime: boolean; day: string }>(
    `SELECT "projectId", "hasStartTime", to_char("startTime", 'YYYY-MM-DD') AS day FROM "Event" WHERE title = $1`,
    [deadline],
  );
  expect(calendar).toEqual([{ projectId: created.id, hasStartTime: false, day: "2026-12-17" }]);

  // Activity shows each change as the person's, via AI Multi.
  const { rows: activity } = await queryDatabase<{ message: string }>(
    `SELECT a.message FROM "Activity" a JOIN "User" u ON u.id = a."userId" WHERE u.email = $1 AND a.message LIKE '%via AI Multi' ORDER BY a."createdAt", a.id`,
    [myEmail],
  );
  expect(activity.map((row) => row.message).sort()).toEqual(
    [`Created project: “${project}” via AI Multi`, `Created task: “${task}” via AI Multi`, `Created event: “${deadline}” via AI Multi`].sort(),
  );

  // A second Apply finds it applied, and nothing is made twice.
  const again = await post(me, proposal.id, "apply");
  expect(again.status).toBe(409);
  expect(again.body.error).toBe("These changes were already applied.");
  expect(await projects()).toHaveLength(1);

  // The stored chat shows it applied, with the same links.
  const { rows: stored } = await queryDatabase<{ status: string; applied: number[]; links: Link[] }>(
    `SELECT status, applied, links FROM "AgentProposal" WHERE id = $1`,
    [proposal.id],
  );
  expect(stored).toEqual([{ status: "APPLIED", applied: [0, 1, 2], links }]);
});

test("the person applies only the changes they ticked; one that needs a change left out is refused, and nothing changes", async () => {
  const project = uniqueName("E2E pick project");
  const task = uniqueName("E2E pick task");
  const finished = uniqueName("E2E pick done");
  const finishedId = await newTask(finished);
  const proposal = proposalIn(
    await ask(me, calls(["create_project", { name: project }], ["create_task", { title: task, project, estimate: { size: "2 h", reason: "A short piece of work." } }], ["complete_task", { task: finished }])),
  );
  const pending = { state: "pending", applied: [] };

  // The task goes in the new project, so it can't go without it; the proposal stays pending.
  const alone = await post(me, proposal.id, "apply", JSON.stringify({ steps: [1] }));
  expect(alone.status).toBe(400);
  expect(alone.body).toMatchObject({ error: `“${task}” can't be applied without “${project}”.`, proposal: pending });
  for (const body of ["{", JSON.stringify({ steps: "all" }), JSON.stringify({ steps: [0], force: true })]) {
    const refused = await post(me, proposal.id, "apply", body);
    expect(refused.status, body).toBe(400);
    expect(refused.body.error).toBe("Choose which changes to apply.");
  }
  for (const steps of [[], [3], [2, 2]]) {
    const refused = await post(me, proposal.id, "apply", JSON.stringify({ steps }));
    expect(refused.status, JSON.stringify(steps)).toBe(400);
    expect(refused.body.proposal).toMatchObject(pending);
  }
  expect((await proposalRow(proposal.id)).status).toBe("PENDING");

  const applied = await post(me, proposal.id, "apply", JSON.stringify({ steps: [2] }));
  expect(applied.status, JSON.stringify(applied.body)).toBe(200);
  expect(applied.body.proposal).toMatchObject({ state: "applied", applied: [2], links: [{ step: 2, title: finished, href: `/tasks?task=${finishedId}` }] });
  expect(await taskRow(finishedId)).toMatchObject({ status: "DONE" });
  // What was left out wasn't made.
  expect((await queryDatabase(`SELECT id FROM "Project" WHERE name = $1`, [project])).rows).toEqual([]);
  expect((await queryDatabase(`SELECT id FROM "Task" WHERE title = $1`, [task])).rows).toEqual([]);
  // Applied once: what was left out can't be applied later.
  const later = await post(me, proposal.id, "apply", JSON.stringify({ steps: [0, 1] }));
  expect(later.status).toBe(409);
  expect(later.body.error).toBe("These changes were already applied.");
});

test("a cancelled proposal changes nothing, and can't be applied afterwards", async () => {
  const title = uniqueName("E2E cancel me");
  const id = await newTask(title);
  const proposal = proposalIn(await ask(me, calls(["complete_task", { task: title }])));
  expect(proposal.steps).toEqual([{ kind: "complete_task", task: { id, name: title, project: null, dueDate: null } }]);

  const cancelled = await post(me, proposal.id, "cancel");
  expect(cancelled.status).toBe(200);
  expect(cancelled.body.proposal?.state).toBe("cancelled");
  expect(await taskRow(id)).toMatchObject({ status: "TODO", deletedAt: null });

  const late = await post(me, proposal.id, "apply");
  expect(late.status).toBe(409);
  expect(late.body).toMatchObject({ error: "These changes were cancelled, so nothing was changed.", proposal: { state: "cancelled" } });
  expect((await post(me, proposal.id, "cancel")).status).toBe(409);
  expect(await taskRow(id)).toMatchObject({ status: "TODO", deletedAt: null });
});

test("when the app refuses one change at Apply, none is made, and the person is told why", async () => {
  const first = uniqueName("E2E trash first");
  const second = uniqueName("E2E trash second");
  const firstId = await newTask(first);
  const secondId = await newTask(second);
  const proposal = proposalIn(await ask(me, calls(["trash_task", { task: first }], ["trash_task", { task: second }])));
  // A deletion lists each task by title.
  expect(proposal.steps).toEqual([
    { kind: "trash_task", task: { id: firstId, name: first, project: null, dueDate: null } },
    { kind: "trash_task", task: { id: secondId, name: second, project: null, dueDate: null } },
  ]);

  // The second task goes to the Trash some other way before Apply.
  expect((await me.delete(`/api/tasks/${secondId}`)).status()).toBe(200);
  const refused = await post(me, proposal.id, "apply");
  expect(refused.status).toBe(409);
  const reason = `Nothing was changed: “${second}” isn't there any more.`;
  expect(refused.body).toMatchObject({ error: reason, proposal: { state: "failed", error: reason } });
  // The first task's change was rolled back with the rest.
  expect(await taskRow(firstId)).toMatchObject({ deletedAt: null });
  expect(await proposalRow(proposal.id)).toMatchObject({ status: "FAILED", error: reason });
});

test("a proposal expires after an hour, and people who can't use the assistant can't apply one", async ({ playwright, browser, baseURL }) => {
  const title = uniqueName("E2E expire me");
  const id = await newTask(title);
  const proposal = proposalIn(await ask(me, calls(["complete_task", { task: title }])));
  await queryDatabase(`UPDATE "AgentProposal" SET "expiresAt" = now() - interval '1 minute' WHERE id = $1`, [proposal.id]);
  const expired = await post(me, proposal.id, "apply");
  expect(expired.status).toBe(409);
  expect(expired.body).toMatchObject({ error: "These changes expired after an hour, so nothing was changed. Ask again for new ones.", proposal: { state: "expired" } });
  expect(await taskRow(id)).toMatchObject({ status: "TODO" });

  const signedOut = await playwright.request.newContext({ baseURL });
  expect((await signedOut.post(`/api/agent/proposals/${proposal.id}/apply`)).status()).toBe(401);
  await signedOut.dispose();
  const guestContext = await browser.newContext();
  contexts.push(guestContext);
  await continueAsGuest(await guestContext.newPage());
  expect((await guestContext.request.post(`/api/agent/proposals/${proposal.id}/apply`)).status()).toBe(403);
});
