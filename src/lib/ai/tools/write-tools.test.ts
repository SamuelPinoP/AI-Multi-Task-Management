// The AI assistant's write tools (#310), run against the evaluations' sample workspace
// (src/lib/ai/evals/workspaces/main.json) in the in-memory database: each one adds a step to the
// answer's draft and changes nothing, finds only what the person can see, and says why when a name
// matches several items or none, so the model asks instead of guessing.
import assert from "node:assert/strict";
import test from "node:test";
import type { z } from "zod";
import { toWallClock } from "../../user-time";
import { createMemoryDb, type Tables } from "../evals/memory-db";
import { loadWorkspace } from "../evals/workspace";
import { MAX_PROPOSAL_STEPS, newDraft, type ProposalStep } from "../proposals";
import type { AgentTool, ToolContext } from "./define";
import { parseDescription } from "../../description-sections";
import { completeTask, createEvent, createProject, createTask, createTicket, trashTask, updateTask } from "./write-tools";

/** The sample workspace as Alex sees it on Thursday, November 19, 2026, at 9:20 AM in Los Angeles. */
function setup({ edit, chat = true, request }: { edit?: (tables: Tables) => void; chat?: boolean; request?: string } = {}) {
  const workspace = loadWorkspace("main");
  edit?.(workspace.tables);
  const before = JSON.stringify(workspace.tables);
  const draft = newDraft();
  const realNow = new Date(workspace.clock.now);
  const context: ToolContext = {
    userId: workspace.person,
    now: toWallClock(workspace.clock.timeZone, realNow),
    realNow,
    timeZone: workspace.clock.timeZone,
    db: createMemoryDb(workspace.tables),
    ...(chat ? { draft } : {}),
    ...(request ? { request } : {}),
  };
  /** Runs a tool as the agent loop does, with its arguments validated first; returns what the model reads. */
  async function call<Input extends z.ZodType>(tool: AgentTool<Input>, args: unknown) {
    const output = await tool.run(tool.input.parse(args), context);
    assert.deepEqual(output.sources, [], "a proposal has no sources: nothing exists yet");
    return output.data as Record<string, unknown>;
  }
  return { draft, call, unchanged: () => JSON.stringify(workspace.tables) === before };
}

test("a new project and its tasks, linked by the project's name or ref, change nothing (#310)", async () => {
  const { draft, call, unchanged } = setup();
  assert.deepEqual(await call(createProject, { name: "Whitewall", description: "Security work" }), { proposed: 'New project "Whitewall"', ref: "new-1", proposedSoFar: 1 });
  assert.deepEqual(await call(createTask, { title: "Harden sign-in", project: "whitewall" }), { proposed: 'New task "Harden sign-in" in "Whitewall"', ref: "new-2", proposedSoFar: 2 });
  await call(createTask, { title: "Security review", project: "new-1", dueDate: "2026-12-17", priority: "HIGH" });
  await call(createTask, { title: "Rotate the keys", project: "Mobile" });
  const whitewall = { ref: "new-1", name: "Whitewall" };
  assert.deepEqual(draft.steps, [
    { kind: "create_project", ref: "new-1", name: "Whitewall", description: "Security work" },
    { kind: "create_task", ref: "new-2", title: "Harden sign-in", description: null, dueDate: null, priority: "NONE", project: whitewall, parent: null },
    { kind: "create_task", ref: "new-3", title: "Security review", description: null, dueDate: "2026-12-17", priority: "HIGH", project: whitewall, parent: null },
    {
      kind: "create_task",
      ref: "new-4",
      title: "Rotate the keys",
      description: null,
      dueDate: null,
      priority: "NONE",
      project: { id: "proj-mobile", name: "Mobile app launch" },
      parent: null,
    },
  ]);
  assert.ok(unchanged());
});

test("a subtask goes in its parent's project, and a subtask can't have subtasks of its own (#310)", async () => {
  const { draft, call } = setup({
    edit: (tables) => {
      const book = tables.task.find((row) => row.id === "task-book");
      if (book) book.parentId = "task-reading";
    },
  });
  // The parent's project wins over the one named, as in the app (SMART-02).
  assert.deepEqual(await call(createTask, { title: "Compare prices at the nursery", parent: "Buy plants for the garden", project: "Book club" }), {
    proposed: 'New subtask "Compare prices at the nursery" under "Buy plants for the garden"',
    ref: "new-1",
    proposedSoFar: 1,
  });
  assert.deepEqual(draft.steps[0], {
    kind: "create_task",
    ref: "new-1",
    title: "Compare prices at the nursery",
    description: null,
    dueDate: null,
    priority: "NONE",
    project: { id: "proj-garden", name: "Garden makeover" },
    parent: { id: "task-plants", name: "Buy plants for the garden" },
  });

  // A task this answer creates can be a parent, by title or ref, but its new subtask can't.
  await call(createTask, { title: "Plan the launch event", project: "Mobile app launch" });
  await call(createTask, { title: "Book the venue", parent: "new-2" });
  assert.deepEqual((draft.steps[2] as Extract<ProposalStep, { kind: "create_task" }>).parent, { ref: "new-2", name: "Plan the launch event" });
  assert.deepEqual((draft.steps[2] as Extract<ProposalStep, { kind: "create_task" }>).project, { id: "proj-mobile", name: "Mobile app launch" });
  assert.deepEqual(await call(createTask, { title: "Pick a pot", parent: "Compare prices at the nursery" }), {
    proposed: null,
    reason: '"Compare prices at the nursery" is a subtask, and subtasks can\'t have their own subtasks.',
  });
  assert.deepEqual(await call(createTask, { title: "Find a review", parent: "Pick the next book" }), {
    proposed: null,
    reason: '"Pick the next book" is a subtask, and subtasks can\'t have their own subtasks.',
  });
  assert.equal(draft.steps.length, 3, "nothing is added when a tool proposes nothing");
});

test("a ticket is a new task whose description the server writes from its parts, ending with the person's words (#433)", async () => {
  const request = "Create a ticket in Mobile app launch: let people sign in with a passkey";
  const { draft, call, unchanged } = setup({ request });
  assert.deepEqual(
    await call(createTicket, {
      title: "Sign in with a passkey",
      summary: "Let people sign in to the mobile app with a passkey instead of a password.",
      background: ["Asked for in Mobile app launch."],
      acceptanceCriteria: ["A person can add a passkey in Settings", "A person can sign in with it", "An e2e test signs in with a passkey"],
      openQuestions: ["Which platforms come first?"],
      estimate: { size: "2 days", reason: "A Settings screen, a change to sign-in and an e2e test." },
      project: "Mobile",
      priority: "HIGH",
    }),
    { proposed: 'New task written as a ticket "Sign in with a passkey" in "Mobile app launch"', ref: "new-1", proposedSoFar: 1 },
  );
  const [step] = draft.steps;
  assert.ok(step.kind === "create_task");
  assert.deepEqual({ ...step, description: undefined }, {
    kind: "create_task",
    ref: "new-1",
    title: "Sign in with a passkey",
    description: undefined,
    dueDate: null,
    priority: "HIGH",
    project: { id: "proj-mobile", name: "Mobile app launch" },
    parent: null,
  });
  const sections = parseDescription(step.description ?? "").sections;
  assert.deepEqual(
    sections.map((section) => section.title),
    ["Summary", "Background", "Acceptance criteria", "Open questions", "Estimate", "Original request"],
  );
  assert.deepEqual(sections[2].body.split("\n"), ["- [ ] A person can add a passkey in Settings", "- [ ] A person can sign in with it", "- [ ] An e2e test signs in with a passkey"]);
  // The estimate is the AI's, with its reason (#434).
  assert.equal(sections[4].body, "**2 days** · AI estimate\nA Settings screen, a change to sign-in and an e2e test.");
  assert.equal(sections[5].body, `> ${request}`);
  assert.ok(unchanged());
});

const SOON = { size: "1 h", reason: "One screen to check." } as const;

test("a ticket can be a subtask, and without criteria or the person's own sections it isn't valid (#433)", async () => {
  const { draft, call } = setup();
  await call(createTicket, { title: "Fix the crash", summary: "The app crashes on launch.", sections: [{ title: "Steps to reproduce", items: ["Open the app"] }], estimate: SOON, parent: "Buy plants" });
  const [step] = draft.steps;
  assert.ok(step.kind === "create_task");
  assert.equal(step.parent?.name, "Buy plants for the garden");
  // Outside a chat there are no words to quote.
  assert.deepEqual(parseDescription(step.description ?? "").sections.map((section) => section.title), ["Summary", "Steps to reproduce", "Estimate"]);
  const invalid = createTicket.input.safeParse({ title: "No criteria", summary: "Something", estimate: SOON });
  assert.equal(invalid.success, false);
  assert.match(JSON.stringify(invalid.error?.issues), /acceptanceCriteria/);
  assert.equal(createTicket.input.safeParse({ title: "Extra field", summary: "S", acceptanceCriteria: ["Done"], estimate: SOON, description: "free text" }).success, false);
  assert.equal(createTicket.input.safeParse({ title: "No estimate", summary: "S", acceptanceCriteria: ["Done"] }).success, false, "every ticket has an estimate (#434)");
});

test("work over 2 days comes with subtasks that split it, offered unticked after the ticket (#434)", async () => {
  const { draft, call, unchanged } = setup();
  const twoStep = {
    title: "Add two-step sign-in",
    summary: "Ask for a code from an authenticator app at sign-in.",
    acceptanceCriteria: ["A person can turn on two-step sign-in", "Sign-in asks for the code"],
    estimate: { size: "1 week", reason: "An app to set up, a code at sign-in, recovery codes, and tests for each." },
    project: "Mobile",
  };
  const split = ["Set up an authenticator app", "Ask for the code at sign-in", "Recovery codes"];
  assert.deepEqual(await call(createTicket, { ...twoStep, split }), {
    proposed: 'New task written as a ticket "Add two-step sign-in" in "Mobile app launch", and 3 subtasks that split it, offered unticked for the person to choose',
    ref: "new-1",
    proposedSoFar: 4,
  });
  const mobile = { id: "proj-mobile", name: "Mobile app launch" };
  assert.deepEqual(
    draft.steps.slice(1),
    split.map((title, index) => ({
      kind: "create_task",
      ref: `new-${index + 2}`,
      title,
      description: null,
      dueDate: null,
      priority: "NONE",
      project: mobile,
      parent: { ref: "new-1", name: "Add two-step sign-in" },
      suggested: true,
    })),
  );
  assert.equal("suggested" in draft.steps[0], false, "the ticket itself is proposed as usual");
  assert.ok(unchanged());

  // Without its split it isn't valid; a ticket that's a subtask can't be split, so it comes alone.
  const unsplit = createTicket.input.safeParse(twoStep);
  assert.equal(unsplit.success, false);
  assert.match(JSON.stringify(unsplit.error?.issues), /over 2 days: give split/);
  const under = setup();
  assert.deepEqual(await under.call(createTicket, { ...twoStep, split, parent: "Buy plants" }), {
    proposed: 'New subtask written as a ticket "Add two-step sign-in" under "Buy plants for the garden". Its split wasn\'t offered: a subtask can\'t have subtasks of its own.',
    ref: "new-1",
    proposedSoFar: 1,
  });

  // As many as the answer has room for.
  const full = setup();
  for (let index = 1; index < MAX_PROPOSAL_STEPS - 1; index += 1) await full.call(createTask, { title: `Task ${index}` });
  assert.match(String((await full.call(createTicket, { ...twoStep, split })).proposed), /, and 1 subtask that split it,/);
  assert.equal(full.draft.steps.length, MAX_PROPOSAL_STEPS);
});

test("a change to a task lists each field, before and after, and nothing to change proposes nothing (#310)", async () => {
  const { draft, call, unchanged } = setup();
  assert.deepEqual(await call(updateTask, { task: "release notes", title: "Write the 2.0 release notes", dueDate: "2026-11-23", priority: "URGENT" }), {
    proposed: 'Change "Write the release notes": title Write the release notes to Write the 2.0 release notes; due date 2026-11-19 to 2026-11-23; priority HIGH to URGENT',
    proposedSoFar: 1,
  });
  await call(updateTask, { task: "Call the dentist", clearDueDate: true, status: "IN_PROGRESS" });
  await call(updateTask, { task: "Read Deep Work", project: "Book club", description: "Two chapters a week." });
  assert.deepEqual(draft.steps, [
    {
      kind: "update_task",
      task: { id: "task-release-notes", name: "Write the release notes", project: "Mobile app launch", dueDate: "2026-11-19" },
      changes: [
        { field: "title", from: "Write the release notes", to: "Write the 2.0 release notes" },
        { field: "dueDate", from: "2026-11-19", to: "2026-11-23" },
        { field: "priority", from: "HIGH", to: "URGENT" },
      ],
    },
    {
      kind: "update_task",
      task: { id: "task-dentist", name: "Call the dentist", project: null, dueDate: "2026-11-19" },
      changes: [
        { field: "dueDate", from: "2026-11-19", to: null },
        { field: "status", from: "TODO", to: "IN_PROGRESS" },
      ],
    },
    {
      kind: "update_task",
      task: { id: "task-reading", name: "Read Deep Work", project: null, dueDate: null },
      changes: [
        { field: "description", from: null, to: "Two chapters a week." },
        { field: "project", from: null, to: { id: "proj-books", name: "Book club" } },
      ],
    },
  ]);

  const same = { proposed: null, reason: '"Call the dentist" already looks like that, so there\'s nothing to change.' };
  assert.deepEqual(await call(updateTask, { task: "Call the dentist", priority: "MEDIUM", dueDate: "2026-11-19" }), same);
  assert.deepEqual(await call(updateTask, { task: "Write the release notes", project: "Mobile app launch" }), {
    proposed: null,
    reason: '"Write the release notes" already looks like that, so there\'s nothing to change.',
  });
  assert.equal(draft.steps.length, 3);
  assert.ok(unchanged());
});

test("marking a task done finds the open one; a task that's done already proposes nothing (#310)", async () => {
  const { draft, call } = setup();
  assert.deepEqual(await call(completeTask, { task: "Call the dentist" }), { proposed: 'Mark "Call the dentist" as done', proposedSoFar: 1 });
  // An id from list_open_tasks works too.
  await call(completeTask, { task: "task-taxes" });
  assert.deepEqual(draft.steps, [
    { kind: "complete_task", task: { id: "task-dentist", name: "Call the dentist", project: null, dueDate: "2026-11-19" } },
    { kind: "complete_task", task: { id: "task-taxes", name: "File the quarterly taxes", project: null, dueDate: "2026-12-15" } },
  ]);
  assert.deepEqual(await call(completeTask, { task: "Draw the wireframes" }), { proposed: null, reason: '"Draw the wireframes" is already done.' });
});

test("an event is all day without a start time, and gets the event form's checks (#310)", async () => {
  const { draft, call } = setup();
  assert.deepEqual(await call(createEvent, { title: "Whitewall deadline", date: "2026-12-17" }), {
    proposed: 'New event "Whitewall deadline" on 2026-12-17, all day',
    ref: "new-1",
    proposedSoFar: 1,
  });
  await call(createEvent, { title: "Call with the designer", date: "2026-11-20", startTime: "15:00", endTime: "15:30", project: "Website" });
  assert.deepEqual(draft.steps[1], {
    kind: "create_event",
    ref: "new-2",
    title: "Call with the designer",
    date: "2026-11-20",
    startTime: "15:00",
    endTime: "15:30",
    description: null,
    project: { id: "proj-website", name: "Website redesign" },
  });
  assert.deepEqual(await call(createEvent, { title: "Stand-up", date: "2026-11-20", endTime: "10:00" }), { proposed: null, reason: "An end time needs a start time." });
  assert.deepEqual(await call(createEvent, { title: "Stand-up", date: "2026-11-20", startTime: "10:00", endTime: "09:30" }), {
    proposed: null,
    reason: "End time must be after start time when dates are the same",
  });
  assert.equal(draft.steps.length, 2);
});

test("moving tasks to the Trash is one step per task, each named, and each task once (#310)", async () => {
  const { draft, call, unchanged } = setup();
  assert.deepEqual(await call(trashTask, { task: "Send the invoice to Acme" }), { proposed: 'Move "Send the invoice to Acme" to the Trash', proposedSoFar: 1 });
  await call(trashTask, { task: "Fix the hero image on the home page" });
  assert.deepEqual(await call(trashTask, { task: "send the invoice to acme" }), { proposed: null, reason: '"Send the invoice to Acme" is already in this proposal.' });
  assert.deepEqual(draft.steps, [
    { kind: "trash_task", task: { id: "task-invoice", name: "Send the invoice to Acme", project: null, dueDate: "2026-11-17" } },
    // A teammate's task in a shared project: members can change its tasks, as in the app.
    { kind: "trash_task", task: { id: "task-hero", name: "Fix the hero image on the home page", project: "Website redesign", dueDate: "2026-11-18" } },
  ]);
  assert.ok(unchanged());
});

test("a name several tasks match proposes nothing and lists them, so the model can ask; an exact title wins (#310)", async () => {
  const { draft, call } = setup();
  const answer = await call(trashTask, { task: "Write" });
  assert.equal(answer.proposed, null);
  assert.equal(answer.reason, '2 tasks match "Write", so it isn\'t clear which one is meant.');
  assert.deepEqual(
    (answer.matches as Array<{ title: string }>).map((match) => match.title).sort(),
    ["Write the About page copy", "Write the release notes"],
  );
  assert.deepEqual(
    (answer.matches as Array<Record<string, unknown>>).find((match) => match.title === "Write the release notes"),
    { title: "Write the release notes", status: "IN_PROGRESS", project: "Mobile app launch", due: "2026-11-19" },
  );
  assert.equal(draft.steps.length, 0);

  const exact = setup({
    edit: (tables) => {
      const invoice = tables.task.find((row) => row.id === "task-invoice");
      if (invoice) tables.task.push({ ...invoice, id: "task-write", title: "Write" });
    },
  });
  assert.deepEqual(await exact.call(trashTask, { task: "write" }), { proposed: 'Move "Write" to the Trash', proposedSoFar: 1 });
});

test("other people's private tasks, tasks in the Trash and projects the person isn't in can't be found (#310)", async () => {
  const { draft, call } = setup();
  const none = (title: string, noun = "task") => ({ proposed: null, reason: `No ${noun} the person can change matches "${title}".` });
  // Lee's task in a project Alex isn't in, and Kim's own task outside any project.
  assert.deepEqual(await call(completeTask, { task: "Prepare salary bands for the Q1 review" }), none("Prepare salary bands for the Q1 review"));
  assert.deepEqual(await call(updateTask, { task: "task-salary-bands", dueDate: "2026-12-01" }), none("task-salary-bands"));
  assert.deepEqual(await call(trashTask, { task: "Pick up the dry cleaning on Elm Street" }), none("Pick up the dry cleaning on Elm Street"));
  assert.deepEqual(await call(trashTask, { task: "Renew the gym membership" }), none("Renew the gym membership"));
  assert.deepEqual(await call(createTask, { title: "Draft the bands", project: "Salary review" }), none("Salary review", "project"));
  assert.deepEqual(await call(createTask, { title: "Draft the bands", parent: "Plan the surprise party for Morgan" }), none("Plan the surprise party for Morgan"));
  assert.deepEqual(await call(createEvent, { title: "Review", date: "2026-12-01", project: "proj-salary" }), none("proj-salary", "project"));
  assert.equal(draft.steps.length, 0);
});

test("outside a chat nothing can be proposed, and one answer proposes at most 20 changes (#310)", async () => {
  const lookup = setup({ chat: false });
  assert.deepEqual(await lookup.call(createProject, { name: "Whitewall" }), { proposed: null, reason: "Changes can't be proposed here." });

  const { draft, call } = setup();
  for (let index = 1; index <= MAX_PROPOSAL_STEPS; index += 1) await call(createTask, { title: `Task ${index}` });
  assert.equal(draft.steps.length, MAX_PROPOSAL_STEPS);
  assert.deepEqual(await call(completeTask, { task: "Call the dentist" }), {
    proposed: null,
    reason: "One answer can propose at most 20 changes; this one has that many already.",
  });
  assert.equal(draft.steps.length, MAX_PROPOSAL_STEPS);
});

test("invalid arguments never reach a tool: unknown fields, empty titles, made-up dates and times (#310)", () => {
  const refused: Array<[AgentTool, unknown]> = [
    [createProject, { name: "" }],
    [createProject, { name: "x".repeat(101) }],
    [createProject, { name: "Whitewall", userId: "someone-else" }],
    [createTask, { title: "  " }],
    [createTask, { title: "Pay rent", dueDate: "tomorrow" }],
    [createTask, { title: "Pay rent", dueDate: "2026-02-30" }],
    // No priority is the default; the model never sets NONE on a new task.
    [createTask, { title: "Pay rent", priority: "NONE" }],
    [updateTask, { task: "Pay rent", status: "ARCHIVED" }],
    [updateTask, { title: "Pay rent" }],
    [completeTask, { task: "Pay rent", force: true }],
    [createEvent, { title: "Stand-up", date: "2026-11-31" }],
    [createEvent, { title: "Stand-up", date: "2026-11-20", startTime: "3pm" }],
    [createEvent, { title: "Stand-up", date: "2026-11-20", startTime: "24:00" }],
    [trashTask, {}],
  ];
  for (const [tool, args] of refused) assert.equal(tool.input.safeParse(args).success, false, `${tool.name} ${JSON.stringify(args)}`);
  assert.equal(updateTask.input.safeParse({ task: "Pay rent", priority: "NONE" }).success, true, "a change can remove a priority");
});
