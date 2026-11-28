// The write tools of AI apps connected over MCP (#479), run against the evaluations' sample
// workspace (src/lib/ai/evals/workspaces/main.json) in the in-memory database, with a writer that
// records what each tool asks the app to write. Each tool finds only what the person can see, names
// items by id or exact title, refuses before writing anything when the request isn't clear, and
// hands the app's own write functions exactly the change asked for. The write functions' rules
// (project roles, the Trash, history) are the app's, tested with its routes and in tests/e2e/mcp.spec.ts.
import assert from "node:assert/strict";
import test from "node:test";
import type { z } from "zod";
import { parseTaskDueDateForStorage } from "../../task-date-buckets";
import { toWallClock } from "../../user-time";
import type { WriteRefusal } from "../../writes";
import { createMemoryDb, type Row, type Tables } from "../evals/memory-db";
import { loadWorkspace } from "../evals/workspace";
import {
  appendToNote,
  CHANGE_TOOLS,
  changedEventTimes,
  commentOnTask,
  completeTask,
  createEvent,
  createNote,
  createProject,
  createTasks,
  deleteEvent,
  deleteNote,
  deleteTask,
  MAX_NEW_TASKS,
  updateEvent,
  updateTask,
} from "./change-tools";
import type { AgentTool, ToolContext, ToolOutput } from "./define";
import type { ToolWriter, Writes, WrittenItem } from "./writer";

type Call = { write: keyof Writes; args: unknown[] };

/**
 * A writer that records each write and answers as the app would, or refuses the whole change.
 * `linked` holds the tasks already made for a web address, by "projectId url".
 */
function fakeWriter(tables: Tables, { refusal, linked = {} }: { refusal?: WriteRefusal; linked?: Record<string, WrittenItem> } = {}) {
  const calls: Call[] = [];
  let made = 0;
  const record = (write: keyof Writes, ...args: unknown[]) => void calls.push({ write, args });
  const titleOf = (model: "task" | "event" | "note", id: string) => String(tables[model].find((row) => row.id === id)?.title || "Untitled note");
  const writes: Writes = {
    async createTask(input) {
      record("createTask", input);
      return { id: `task-new-${++made}`, title: input.title, projectId: input.projectId };
    },
    async updateTask(id, input) {
      record("updateTask", id, input);
      return { id, title: input.title };
    },
    async trashTask(id) {
      record("trashTask", id);
      return { id, title: titleOf("task", id) };
    },
    async addSourceLink(taskId, url) {
      record("addSourceLink", taskId, url);
    },
    async findTaskForSourceLink(url, projectId) {
      record("findTaskForSourceLink", url, projectId);
      return linked[`${projectId ?? ""} ${url}`] ?? null;
    },
    async addComment(taskId, body) {
      record("addComment", taskId, body);
      return { id: "comment-1" };
    },
    async createProject(input) {
      record("createProject", input);
      return { id: `project-new-${++made}`, name: input.name };
    },
    async createEvent(input) {
      record("createEvent", input);
      return { id: `event-new-${++made}`, title: input.title };
    },
    async updateEvent(id, input) {
      record("updateEvent", id, input);
      return { id, title: input.title };
    },
    async trashEvent(id) {
      record("trashEvent", id);
      return { id, title: titleOf("event", id) };
    },
    async createNote(input) {
      record("createNote", input);
      return { id: `note-new-${++made}`, title: input.title || "Untitled note" };
    },
    async updateNote(id, input) {
      record("updateNote", id, input);
      return { id, title: input.title || "Untitled note" };
    },
    async trashNote(id) {
      record("trashNote", id);
      return { id, title: titleOf("note", id) };
    },
  };
  const writer: ToolWriter = {
    async apply(change) {
      if (refusal) return refusal;
      return { ok: true, value: await change(writes) };
    },
  };
  return { writer, calls };
}

/** The sample workspace as Alex sees it on Thursday, November 19, 2026, at 9:20 AM in Los Angeles, connected through an app allowed to make changes. */
function setup({ edit, refusal, linked, writer = true }: { edit?: (tables: Tables) => void; refusal?: WriteRefusal; linked?: Record<string, WrittenItem>; writer?: boolean } = {}) {
  const workspace = loadWorkspace("main");
  edit?.(workspace.tables);
  const before = JSON.stringify(workspace.tables);
  const fake = fakeWriter(workspace.tables, { refusal, linked });
  const realNow = new Date(workspace.clock.now);
  const context: ToolContext = {
    userId: workspace.person,
    now: toWallClock(workspace.clock.timeZone, realNow),
    realNow,
    timeZone: workspace.clock.timeZone,
    db: createMemoryDb(workspace.tables),
    ...(writer ? { writer: fake.writer } : {}),
  };
  /** Runs a tool as the MCP server does, with its arguments validated by its own schema first. */
  async function call<Input extends z.ZodType>(tool: AgentTool<Input>, args: unknown): Promise<ToolOutput & { data: Record<string, unknown> }> {
    const output = await tool.run(tool.input.parse(args), context);
    return output as ToolOutput & { data: Record<string, unknown> };
  }
  const writes = () => fake.calls.map((entry) => entry.write);
  return { call, calls: fake.calls, writes, untouched: () => JSON.stringify(workspace.tables) === before };
}

/** Numbers for the tasks tests add, clear of the sample workspace's. */
let nextNumber = 900;

/** A task row like the sample workspace's, for tests that need one more. */
function taskRow(fields: Row): Row {
  return {
    number: nextNumber++,
    description: null,
    parentId: null,
    recurrence: "NONE",
    status: "TODO",
    priority: "NONE",
    dueDate: null,
    userId: "user-alex",
    projectId: null,
    assigneeId: null,
    goalId: null,
    completedAt: null,
    deletedAt: null,
    createdAt: new Date("2026-11-01T00:00:00.000Z"),
    updatedAt: new Date("2026-11-10T00:00:00.000Z"),
    ...fields,
  };
}

/** The reason a tool gives when it changed nothing. */
const reasonOf = (output: ToolOutput) => (output.data as { reason: string }).reason;

test("every write tool refuses without a writer, before reading anything: the in-app assistant never makes changes", async () => {
  const { call, writes } = setup({ writer: false });
  const valid: Record<string, unknown> = {
    create_tasks: { tasks: [{ title: "Dark mode" }] },
    update_task: { task: "Call the dentist", priority: "HIGH" },
    complete_task: { task: "Call the dentist" },
    comment_on_task: { task: "Call the dentist", comment: "Done?" },
    create_event: { title: "Review", date: "2026-11-27" },
    update_event: { event: "Dentist appointment", title: "Dentist" },
    create_note: { title: "Ideas" },
    append_to_note: { note: "Soup recipes", text: "More salt." },
    create_project: { name: "Whitewall" },
    delete_task: { task: "Call the dentist" },
    delete_event: { event: "Dentist appointment" },
    delete_note: { note: "Soup recipes" },
  };
  assert.deepEqual(Object.keys(valid), CHANGE_TOOLS.map((tool) => tool.name));
  for (const tool of CHANGE_TOOLS as AgentTool[]) {
    const output = await call(tool, valid[tool.name]);
    assert.equal(output.refused, true, tool.name);
    assert.match(reasonOf(output), /didn't allow this app to make changes/, tool.name);
  }
  assert.deepEqual(writes(), []);
});

test("schemas: strict objects, required references, and \"\" or null counts as left out", () => {
  assert.throws(() => updateTask.input.parse({ task: "Call the dentist", owner: "user-kim" }), /Unrecognized key/);
  assert.throws(() => deleteTask.input.parse({ task: "  " }));
  assert.throws(() => createTasks.input.parse({ tasks: [] }));
  assert.throws(() => createTasks.input.parse({ tasks: Array.from({ length: MAX_NEW_TASKS + 1 }, (_, index) => ({ title: `Task ${index}` })) }));
  const leftOut = updateTask.input.parse({ task: "Call the dentist", title: "", dueDate: null, priority: "HIGH" });
  assert.deepEqual(JSON.parse(JSON.stringify(leftOut)), { task: "Call the dentist", priority: "HIGH" });
  assert.deepEqual([leftOut.title, leftOut.dueDate], [undefined, undefined]);
  assert.throws(() => updateTask.input.parse({ task: "x", project: "Garden makeover", removeFromProject: true }), /not both/);
  assert.throws(() => updateTask.input.parse({ task: "x", assignee: "Kim", unassign: true }), /not both/);
  assert.throws(() => updateEvent.input.parse({ event: "x", allDay: true, startTime: "09:00" }), /all-day event has no times/);
  assert.throws(() => createEvent.input.parse({ title: "Review", date: "2026-11-27", startTime: "25:00" }), /24-hour time/);
  // Source links are web pages, kept in one spelling so the same link always matches.
  for (const sourceUrl of ["ftp://example.com/x", "javascript:alert(1)", "github.com/acme/app/pull/12", "https://"]) {
    assert.throws(() => createTasks.input.parse({ tasks: [{ title: "x", sourceUrl }] }), /web address/, sourceUrl);
  }
  const parsed = createTasks.input.parse({ tasks: [{ title: "x", sourceUrl: " https://GitHub.com/acme/app/pull/12 " }] });
  assert.equal(parsed.tasks[0].sourceUrl, "https://github.com/acme/app/pull/12");
});

test("create_tasks: tasks go in the project named exactly, as the person's, and each answer names and links what it made", async () => {
  const { call, calls, untouched } = setup();
  const output = await call(createTasks, {
    tasks: [
      { title: "Add a dark and light mode", project: "mobile app launch", priority: "HIGH", dueDate: "2026-11-30", description: "Both themes." },
      { title: "Renew the domain" },
    ],
  });
  assert.equal(output.refused, undefined);
  assert.deepEqual(calls, [
    {
      write: "createTask",
      args: [
        {
          title: "Add a dark and light mode",
          description: "Both themes.",
          // A date without a time, stored as the app stores it (src/lib/task-date-buckets.ts).
          dueDate: parseTaskDueDateForStorage("2026-11-30"),
          priority: "HIGH",
          projectId: "proj-mobile",
          assigneeId: null,
          parentId: null,
          noteId: null,
        },
      ],
    },
    {
      write: "createTask",
      args: [{ title: "Renew the domain", description: "", dueDate: null, priority: undefined, projectId: null, assigneeId: null, parentId: null, noteId: null }],
    },
  ]);
  assert.deepEqual(output.data, {
    changed: "Created 2 tasks.",
    created: [
      { id: "task-new-1", title: "Add a dark and light mode", project: "Mobile app launch" },
      { id: "task-new-2", title: "Renew the domain" },
    ],
    skipped: [],
  });
  assert.deepEqual(output.sources, [
    { kind: "task", id: "task-new-1", title: "Add a dark and light mode", href: "/tasks/task-new-1" },
    { kind: "task", id: "task-new-2", title: "Renew the domain", href: "/tasks/task-new-2" },
  ]);
  assert.ok(untouched(), "the tools never write through the database they read");
});

test("create_tasks: a project named by part of its name, or one the person can't see, stops every task before anything is written", async () => {
  const { call, writes } = setup();
  const partial = await call(createTasks, { tasks: [{ title: "Fine", project: "Garden makeover" }, { title: "Hero copy", project: "website" }] });
  assert.equal(partial.refused, true);
  assert.equal(reasonOf(partial), 'Task 2 (“Hero copy”): No project is called exactly "website". Nothing was changed: if the person means one of these, call again with its id.');
  assert.deepEqual(partial.data.matches, [{ id: "proj-website", name: "Website redesign" }]);

  // Lee's Salary review: Alex isn't a member, so it doesn't exist for this app.
  const hidden = await call(createTasks, { tasks: [{ title: "Bands", project: "Salary review" }] });
  assert.equal(reasonOf(hidden), '“Bands”: No project the person can see is called "Salary review". Nothing was changed.');
  assert.equal(hidden.data.matches, undefined);
  assert.deepEqual(writes(), []);
});

test("create_tasks: a subtask goes in its parent's project, and a subtask can't be a parent", async () => {
  const { call, calls } = setup({
    edit: (tables) => tables.task.push(taskRow({ id: "task-sub", title: "Draft the changelog", projectId: "proj-mobile", parentId: "task-release-notes" })),
  });
  await call(createTasks, { tasks: [{ title: "Proofread", parent: "task-release-notes", project: "Garden makeover" }] });
  assert.deepEqual(calls.map((entry) => entry.args[0]), [
    { title: "Proofread", description: "", dueDate: null, priority: undefined, projectId: "proj-mobile", assigneeId: null, parentId: "task-release-notes", noteId: null },
  ]);
  const nested = await call(createTasks, { tasks: [{ title: "Too deep", parent: "Draft the changelog" }] });
  assert.equal(reasonOf(nested), "“Too deep”: “Draft the changelog” is a subtask, and subtasks can't have their own subtasks. Nothing was changed.");
  assert.equal(calls.length, 1);
});

test("create_tasks: a web address that already has a task in that project is skipped and reported, so asking twice adds nothing", async () => {
  const pr = (n: number) => `https://github.com/acme/app/pull/${n}`;
  const { call, calls } = setup({ linked: { [`proj-mobile ${pr(12)}`]: { id: "task-app-store", title: "Submit the app to the store" } } });
  const output = await call(createTasks, {
    tasks: [
      { title: "Review PR 12", project: "Mobile app launch", sourceUrl: pr(12) },
      { title: "Review PR 13", project: "Mobile app launch", sourceUrl: pr(13) },
      // The same link twice in one call makes one task.
      { title: "Review PR 13 again", project: "Mobile app launch", sourceUrl: pr(13) },
      // The same link in another place is another task.
      { title: "Review PR 12 at home", sourceUrl: pr(12) },
    ],
  });
  assert.deepEqual(
    calls.map(({ write, args }) => [write, ...args.map((arg) => (typeof arg === "object" && arg ? (arg as { title: string }).title : arg))]),
    [
      ["findTaskForSourceLink", pr(12), "proj-mobile"],
      ["findTaskForSourceLink", pr(13), "proj-mobile"],
      ["createTask", "Review PR 13"],
      ["addSourceLink", "task-new-1", pr(13)],
      ["findTaskForSourceLink", pr(12), null],
      ["createTask", "Review PR 12 at home"],
      ["addSourceLink", "task-new-2", pr(12)],
    ],
  );
  assert.equal(output.data.changed, "Created 2 tasks; skipped 2 tasks whose web address already has one.");
  assert.deepEqual(output.data.skipped, [
    { title: "Review PR 12", sourceUrl: pr(12), existingTask: { id: "task-app-store", title: "Submit the app to the store" } },
    { title: "Review PR 13 again", sourceUrl: pr(13), existingTask: { id: "task-new-1", title: "Review PR 13" } },
  ]);

  // Nothing new: not an error, and it says so.
  const again = setup({ linked: { [`proj-mobile ${pr(12)}`]: { id: "task-app-store", title: "Submit the app to the store" } } });
  const second = await again.call(createTasks, { tasks: [{ title: "Review PR 12", project: "Mobile app launch", sourceUrl: pr(12) }] });
  assert.equal(second.refused, undefined);
  assert.deepEqual([second.data.changed, reasonOf(second)], [null, "Created no tasks; skipped 1 task whose web address already has one."]);
  assert.deepEqual(again.writes(), ["findTaskForSourceLink"]);
});

test("create_tasks: when the app refuses a write, nothing was created, and the app reads why", async () => {
  const { call } = setup({ refusal: { ok: false, status: 403, error: "You do not have permission to create tasks on this project." } });
  const output = await call(createTasks, { tasks: [{ title: "Hero copy", project: "Website redesign" }] });
  assert.equal(output.refused, true);
  assert.equal(reasonOf(output), "Nothing was changed: the person can't make this change (You do not have permission to create tasks on this project).");
});

test("update_task: finds the task by its exact title, ignoring case, and hands updateTask the task as it is with only those fields changed", async () => {
  const { call, calls } = setup();
  const output = await call(updateTask, { task: "write the release notes", priority: "URGENT", dueDate: "2026-11-25", status: "DONE", description: "Mention the beta." });
  assert.deepEqual(calls, [
    {
      write: "updateTask",
      args: [
        "task-release-notes",
        {
          title: "Write the release notes",
          status: "DONE",
          priority: "URGENT",
          recurrence: "NONE",
          dueDate: parseTaskDueDateForStorage("2026-11-25"),
          description: "Mention the beta.",
          projectId: "proj-mobile",
          assigneeId: null,
        },
      ],
    },
  ]);
  assert.equal(
    output.data.changed,
    "Changed “Write the release notes”: changed the description; moved it to Done; set the priority to Urgent; set the due date to 2026-11-25.",
  );
  assert.deepEqual(output.sources, [{ kind: "task", id: "task-release-notes", title: "Write the release notes", href: "/tasks/task-release-notes" }]);
});

test("update_task: only an id or an exact title names a task; anything else changes nothing and lists the closest with their ids", async () => {
  const { call, writes } = setup({ edit: (tables) => tables.task.push(taskRow({ id: "task-dentist-2", title: "Call the dentist" })) });
  const partial = await call(updateTask, { task: "invoice", priority: "HIGH" });
  assert.equal(reasonOf(partial), 'No task is called exactly "invoice". Nothing was changed: if the person means one of these, call again with its id.');
  assert.deepEqual(partial.data.matches, [{ id: "task-invoice", title: "Send the invoice to Acme", status: "TODO", due: "2026-11-17" }]);

  const twice = await call(updateTask, { task: "Call the dentist", priority: "HIGH" });
  assert.match(reasonOf(twice), /^2 tasks are called "Call the dentist", so it isn't clear which one is meant/);
  assert.deepEqual((twice.data.matches as Array<{ id: string }>).map((match) => match.id).sort(), ["task-dentist", "task-dentist-2"]);

  // By id, it's clear.
  await call(updateTask, { task: "task-dentist-2", priority: "HIGH" });
  assert.deepEqual(writes(), ["updateTask"]);
});

test("update_task: a task's number, such as AM-104, names it in any case (#486); someone else's number names nothing", async () => {
  const { call, writes } = setup();
  const output = await call(updateTask, { task: "am-104", priority: "LOW" });
  assert.equal(output.data.changed, "Changed “Write the release notes”: set the priority to Low.");
  assert.deepEqual(writes(), ["updateTask"]);
  // AM-118 is Lee's salary bands, in a project the person isn't in.
  const hidden = await call(updateTask, { task: "AM-118", priority: "HIGH" });
  assert.equal(reasonOf(hidden), 'No task the person can see is called "AM-118". Nothing was changed.');
  assert.deepEqual(writes(), ["updateTask"]);
});

test("update_task: other people's own tasks, tasks in projects the person isn't in, and tasks in the Trash don't exist for the app", async () => {
  const { call, writes } = setup();
  for (const title of ["Plan the surprise party for Morgan", "Prepare salary bands for the Q1 review", "Pick up the dry cleaning on Elm Street", "Renew the gym membership at Iron Temple"]) {
    const output = await call(updateTask, { task: title, priority: "HIGH" });
    assert.equal(output.refused, true, title);
    assert.equal(reasonOf(output), `No task the person can see is called "${title}". Nothing was changed.`);
  }
  // A shared project's task, which Kim owns, is the person's to change: they're a member.
  await call(updateTask, { task: "Write the About page copy", priority: "LOW" });
  assert.deepEqual(writes(), ["updateTask"]);
});

test("update_task: a change to nothing new writes nothing", async () => {
  const { call, writes } = setup();
  const output = await call(updateTask, { task: "Run the beta test", status: "DONE", title: "Run the beta test" });
  assert.equal(output.refused, undefined);
  assert.deepEqual(output.data, { changed: null, reason: "“Run the beta test” already looks like that, so nothing was changed." });
  assert.deepEqual(writes(), []);
});

test("update_task: assignees are members of the task's project, by name or \"me\"; moving a task drops its old project's assignee", async () => {
  const { call, calls } = setup();
  const kim = await call(updateTask, { task: "Fix the hero image on the home page", assignee: "kim" });
  assert.equal((calls[0].args[1] as { assigneeId: string }).assigneeId, "member-website-kim");
  assert.equal(kim.data.changed, "Changed “Fix the hero image on the home page”: assigned it to Kim.");
  await call(updateTask, { task: "Write the About page copy", assignee: "me" });
  assert.equal((calls[1].args[1] as { assigneeId: string }).assigneeId, "member-website-alex");

  const stranger = await call(updateTask, { task: "Fix the hero image on the home page", assignee: "Morgan" });
  assert.equal(reasonOf(stranger), 'No member of “Website redesign” is called "Morgan". Nothing was changed.');
  assert.deepEqual(stranger.data.members, ["Alex", "Kim"]);
  const personal = await call(updateTask, { task: "Call the dentist", assignee: "me" });
  assert.match(reasonOf(personal), /isn't in a project, and only a project's tasks have assignees/);

  const moved = await call(updateTask, { task: "Fix the hero image on the home page", project: "Mobile app launch" });
  assert.deepEqual(calls[2].args[1], {
    title: "Fix the hero image on the home page",
    status: "IN_PROGRESS",
    priority: "URGENT",
    recurrence: "NONE",
    dueDate: new Date("2026-11-18T00:00:00.000Z"),
    description: "",
    projectId: "proj-mobile",
    assigneeId: null,
  });
  assert.equal(moved.data.changed, "Changed “Fix the hero image on the home page”: moved it to “Mobile app launch”; unassigned Alex, a member of the old project.");
  assert.equal(calls.length, 3);
});

test("update_task: a subtask stays in its parent's project", async () => {
  const { call, writes } = setup({
    edit: (tables) => tables.task.push(taskRow({ id: "task-sub", title: "Draft the changelog", projectId: "proj-mobile", parentId: "task-release-notes" })),
  });
  for (const args of [{ project: "Garden makeover" }, { removeFromProject: true }]) {
    const output = await call(updateTask, { task: "Draft the changelog", ...args });
    assert.equal(reasonOf(output), "“Draft the changelog” is a subtask, so it stays in its parent's project. Nothing was changed.");
  }
  assert.deepEqual(writes(), []);
});

test("update_task: labels are set by name from the task's own labels: its project's, or the person's for a task of theirs", async () => {
  const { call, calls } = setup({
    edit: (tables) => {
      tables.label.push(
        { id: "label-bug", name: "bug", projectId: "proj-website", userId: null },
        { id: "label-design", name: "Design", projectId: "proj-website", userId: null },
        { id: "label-home", name: "home", projectId: null, userId: "user-alex" },
        { id: "label-kim", name: "errands", projectId: null, userId: "user-kim" },
      );
      tables.taskLabel.push({ taskId: "task-hero", labelId: "label-bug" });
    },
  });
  const set = await call(updateTask, { task: "Fix the hero image on the home page", labels: ["design", "Bug"] });
  assert.deepEqual((calls[0].args[1] as { labelIds: string[] }).labelIds, ["label-design", "label-bug"]);
  assert.equal(set.data.changed, "Changed “Fix the hero image on the home page”: set its labels to “Design”, “bug”.");

  const same = await call(updateTask, { task: "Fix the hero image on the home page", labels: ["bug"] });
  assert.equal(same.data.changed, null, "it already has exactly that label");

  const wrongScope = await call(updateTask, { task: "Fix the hero image on the home page", labels: ["home"] });
  assert.equal(reasonOf(wrongScope), '"home" isn\'t a label in “Website redesign”. Nothing was changed: labels are added in the app.');
  assert.deepEqual([...(wrongScope.data.labels as string[])].sort(), ["Design", "bug"]);

  await call(updateTask, { task: "Call the dentist", labels: ["home"] });
  assert.deepEqual((calls[1].args[1] as { labelIds: string[] }).labelIds, ["label-home"]);
  const others = await call(updateTask, { task: "Call the dentist", labels: ["errands"] });
  assert.equal(others.refused, true, "another person's labels aren't the person's");
  const cleared = await call(updateTask, { task: "Fix the hero image on the home page", labels: [] });
  assert.equal(cleared.data.changed, "Changed “Fix the hero image on the home page”: removed its labels.");
  assert.equal(calls.length, 3);
});

test("complete_task: marks the open task done; a task already done changes nothing", async () => {
  const { call, calls } = setup();
  const output = await call(completeTask, { task: "Write the release notes" });
  assert.deepEqual(calls.map(({ write, args }) => [write, args[0], (args[1] as { status: string }).status]), [["updateTask", "task-release-notes", "DONE"]]);
  assert.equal(output.data.changed, "Marked “Write the release notes” as done.");

  const done = await call(completeTask, { task: "Run the beta test" });
  assert.equal(done.refused, undefined);
  assert.equal(reasonOf(done), "“Run the beta test” is already done, so nothing was changed.");
  assert.equal(calls.length, 1);
});

test("comment_on_task: the comment goes on the task as the person wrote it, line breaks kept", async () => {
  const { call, calls } = setup();
  const output = await call(commentOnTask, { task: "Fix the hero image on the home page", comment: "Looks good.\r\n@Kim can you check the phone layout?" });
  assert.deepEqual(calls, [{ write: "addComment", args: ["task-hero", "Looks good.\n@Kim can you check the phone layout?"] }]);
  assert.equal(output.data.changed, "Commented on “Fix the hero image on the home page”.");
  assert.equal(output.data.commentId, "comment-1");
});

test("delete_task, delete_event and delete_note move one item to the Trash, and say where it went", async () => {
  const { call, calls } = setup();
  const task = await call(deleteTask, { task: "Call the dentist" });
  const event = await call(deleteEvent, { event: "Dentist appointment" });
  const note = await call(deleteNote, { note: "soup recipes" });
  assert.deepEqual(calls, [
    { write: "trashTask", args: ["task-dentist"] },
    { write: "trashEvent", args: ["event-dentist"] },
    { write: "trashNote", args: ["note-soup"] },
  ]);
  assert.equal(task.data.changed, "Moved “Call the dentist” to the Trash, where the person can restore it.");
  for (const [output, kind] of [
    [task, "task"],
    [event, "event"],
    [note, "note"],
  ] as const) {
    assert.deepEqual(output.sources.map((source) => [source.kind, source.href]), [[kind, "/trash"]]);
  }
  // Already in the Trash, or someone else's: nothing to delete.
  const gone = await call(deleteEvent, { event: "Car service at Speedy Garage" });
  const lees = await call(deleteNote, { note: "Salary bands draft" });
  assert.deepEqual([gone.refused, lees.refused], [true, true]);
  assert.equal(calls.length, 3);
});

test("create_event: the event form's own checks, times as typed, and repeats with their last day", async () => {
  const { call, calls } = setup();
  const output = await call(createEvent, { title: "Design review", date: "2026-11-27", startTime: "15:00", endTime: "16:00", project: "Website redesign", location: "Room 4" });
  assert.deepEqual(calls[0], {
    write: "createEvent",
    args: [
      {
        title: "Design review",
        description: null,
        location: "Room 4",
        times: { startTime: new Date("2026-11-27T15:00:00.000Z"), endTime: new Date("2026-11-27T16:00:00.000Z"), hasStartTime: true, hasEndTime: true },
        recurrence: "NONE",
        repeatUntil: null,
        projectId: "proj-website",
      },
    ],
  });
  assert.equal(output.data.changed, "Added “Design review” on 2026-11-27 at 15:00 in “Website redesign”.");
  assert.deepEqual(output.sources, [{ kind: "event", id: "event-new-1", title: "Design review", href: "/events?event=event-new-1" }]);

  const weekly = await call(createEvent, { title: "Standup", date: "2026-11-23", startTime: "09:30", repeat: "WEEKLY", repeatUntil: "2026-12-31" });
  const repeated = calls[1].args[0] as { recurrence: string; repeatUntil: Date };
  assert.deepEqual([repeated.recurrence, repeated.repeatUntil], ["WEEKLY", new Date("2026-12-31T00:00:00.000Z")]);
  assert.equal(weekly.data.changed, "Added “Standup” on 2026-11-23 at 09:30, repeating weekly until Dec 31, 2026.");

  const refusals = [
    [{ title: "Late", date: "2026-11-27", startTime: "16:00", endTime: "15:00" }, "End time must be after start time when dates are the same. Nothing was changed."],
    [{ title: "Loop", date: "2026-11-27", repeat: "DAILY", repeatUntil: "2026-11-01" }, "Repeat until cannot be before the start date. Nothing was changed."],
    [{ title: "Loop", date: "2026-11-27", repeatUntil: "2026-12-01" }, "repeatUntil is for a repeating event: give repeat too. Nothing was changed."],
    [{ title: "End only", date: "2026-11-27", endTime: "10:00" }, "An end time needs a start time. Nothing was changed."],
  ] as const;
  for (const [args, reason] of refusals) assert.equal(reasonOf(await call(createEvent, args)), reason);
  assert.equal(calls.length, 2);
});

test("an event whose start moves keeps its length; all-day drops the times; an end given is kept", () => {
  const meeting = { startTime: new Date("2026-11-20T15:00:00.000Z"), endTime: new Date("2026-11-20T16:00:00.000Z"), hasStartTime: true, hasEndTime: true };
  assert.deepEqual(changedEventTimes(meeting, {}), { startDate: "2026-11-20", startTime: "15:00", endDate: "2026-11-20", endTime: "16:00" });
  assert.deepEqual(changedEventTimes(meeting, { startTime: "16:30" }), { startDate: "2026-11-20", startTime: "16:30", endDate: "2026-11-20", endTime: "17:30" });
  assert.deepEqual(changedEventTimes(meeting, { date: "2026-11-24" }), { startDate: "2026-11-24", startTime: "15:00", endDate: "2026-11-24", endTime: "16:00" });
  assert.deepEqual(changedEventTimes(meeting, { startTime: "23:30" }), { startDate: "2026-11-20", startTime: "23:30", endDate: "2026-11-21", endTime: "00:30" });
  assert.deepEqual(changedEventTimes(meeting, { startTime: "09:00", endTime: "09:15" }), { startDate: "2026-11-20", startTime: "09:00", endDate: "2026-11-20", endTime: "09:15" });
  assert.deepEqual(changedEventTimes(meeting, { allDay: true }), { startDate: "2026-11-20", startTime: null, endDate: null, endTime: null });

  const trip = { startTime: new Date("2026-12-01T00:00:00.000Z"), endTime: new Date("2026-12-04T00:00:00.000Z"), hasStartTime: false, hasEndTime: false };
  assert.deepEqual(changedEventTimes(trip, { date: "2026-12-10" }), { startDate: "2026-12-10", startTime: null, endDate: "2026-12-13", endTime: null });
  // Untouched, an all-day event keeps the end it has.
  assert.deepEqual(changedEventTimes(trip, {}), { startDate: "2026-12-01", startTime: null, endDate: "2026-12-04", endTime: null });
});

test("update_event: changes what's given, keeps the rest, stops or changes repeats, and refuses what the event form would", async () => {
  const { call, calls } = setup();
  const later = await call(updateEvent, { event: "dentist appointment", startTime: "16:30", location: "Main St" });
  const input = calls[0].args[1] as { times: unknown; location: string; title: string; recurrence: string; repeatUntil: unknown; projectId: unknown };
  assert.equal(calls[0].args[0], "event-dentist");
  assert.deepEqual(input.times, { startTime: new Date("2026-11-20T16:30:00.000Z"), endTime: new Date("2026-11-20T17:30:00.000Z"), hasStartTime: true, hasEndTime: true });
  assert.deepEqual([input.title, input.location, input.recurrence, input.repeatUntil, input.projectId], ["Dentist appointment", "Main St", "NONE", null, null]);
  assert.equal(later.data.changed, "Changed “Dentist appointment”: moved it to 2026-11-20 at 16:30–17:30; set the location to “Main St”.");

  const stopped = await call(updateEvent, { event: "Weekly planning", repeat: "NONE" });
  assert.deepEqual([(calls[1].args[1] as { recurrence: string }).recurrence, (calls[1].args[1] as { repeatUntil: unknown }).repeatUntil], ["NONE", null]);
  assert.equal(stopped.data.changed, "Changed “Weekly planning”: stopped it repeating.");

  const until = await call(updateEvent, { event: "Yoga class", repeatUntil: "2026-12-15" });
  assert.equal(until.data.changed, "Changed “Yoga class”: set it to repeat weekly until Dec 15, 2026.");

  const allDay = await call(updateEvent, { event: "Lunch with Jordan", allDay: true });
  assert.deepEqual((calls[3].args[1] as { times: unknown }).times, { startTime: new Date("2026-11-19T00:00:00.000Z"), endTime: null, hasStartTime: false, hasEndTime: false });
  assert.equal(allDay.data.changed, "Changed “Lunch with Jordan”: moved it to 2026-11-19, all day.");

  const same = await call(updateEvent, { event: "Thanksgiving dinner", title: "Thanksgiving dinner" });
  assert.deepEqual(same.data, { changed: null, reason: "“Thanksgiving dinner” already looks like that, so nothing was changed." });
  const backwards = await call(updateEvent, { event: "Dentist appointment", endTime: "14:00" });
  assert.equal(reasonOf(backwards), "End time must be after start time when dates are the same. Nothing was changed.");
  const lees = await call(updateEvent, { event: "Doctor visit at Northside Clinic", title: "Doctor" });
  assert.equal(lees.refused, true, "another person's own event doesn't exist for the app");
  assert.equal(calls.length, 4);
});

test("create_note, append_to_note and create_project: the note or project as asked, and appended text after what's there", async () => {
  const { call, calls } = setup();
  const note = await call(createNote, { title: "Ideas", content: "Dark mode first.", project: "Mobile app launch" });
  assert.deepEqual(calls[0], { write: "createNote", args: [{ title: "Ideas", content: "Dark mode first.", projectId: "proj-mobile" }] });
  assert.equal(note.data.changed, "Wrote the note “Ideas” in “Mobile app launch”.");
  assert.deepEqual(note.sources, [{ kind: "note", id: "note-new-1", title: "Ideas", href: "/notes?openNote=note-new-1" }]);

  const added = await call(appendToNote, { note: "Soup recipes", text: "Pumpkin soup: add ginger." });
  const [id, update] = calls[1].args as [string, { title: string; content: string; projectId: null }];
  assert.equal(id, "note-soup");
  assert.equal(update.title, "Soup recipes");
  assert.equal(update.projectId, null);
  assert.ok(update.content.startsWith("Tomato soup: roast the tomatoes"), "what the note said stays first");
  assert.ok(update.content.endsWith("\n\nPumpkin soup: add ginger."), "the new text is a paragraph of its own");
  assert.equal(added.data.changed, "Added to “Soup recipes”.");
  const hidden = await call(appendToNote, { note: "Salary bands draft", text: "x" });
  assert.equal(hidden.refused, true);

  const project = await call(createProject, { name: "Whitewall", description: "" });
  assert.deepEqual(calls[2], { write: "createProject", args: [{ name: "Whitewall", description: null }] });
  assert.equal(project.data.changed, "Created the project “Whitewall”.");
  assert.equal(calls.length, 3);
});

test("a write the app refuses as gone or not allowed becomes a reason the app can read", async () => {
  const gone = setup({ refusal: { ok: false, status: 404, error: "Task not found" } });
  assert.equal(reasonOf(await gone.call(completeTask, { task: "Call the dentist" })), "Nothing was changed: “Call the dentist” isn't there any more.");
  const busy = setup({ refusal: { ok: false, status: 429, error: "That's a lot of comments at once. Try again in a minute." } });
  assert.equal(
    reasonOf(await busy.call(commentOnTask, { task: "Call the dentist", comment: "Hi" })),
    "Nothing was changed: That's a lot of comments at once. Try again in a minute.",
  );
  const invalid = setup({ refusal: { ok: false, status: 400, error: "Invalid project" } });
  assert.equal(reasonOf(await invalid.call(createNote, { title: "Ideas" })), "Nothing was changed: AI Multi refused it (Invalid project).");
});
