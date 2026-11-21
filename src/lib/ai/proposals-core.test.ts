import assert from "node:assert/strict";
import test from "node:test";
import { parseTaskDueDateForStorage } from "../task-date-buckets";
import { isExisting, type ItemRef, type ProposalStep } from "./proposals";
import { parseApplyRequest, proposalView, refusalMessage, storedLinks, storedSteps, taskUpdateInput, type CurrentTask } from "./proposals-core";

const whitewall = { ref: "new-1", name: "Whitewall" };
const releaseNotes = { id: "task-release-notes", name: "Write the release notes", project: "Mobile app launch", dueDate: "2026-11-19" };
const STEPS: ProposalStep[] = [
  { kind: "create_project", ref: "new-1", name: "Whitewall", description: "Security work" },
  { kind: "create_task", ref: "new-2", title: "Harden sign-in", description: null, dueDate: "2026-12-17", priority: "HIGH", project: whitewall, parent: null },
  { kind: "update_task", task: releaseNotes, changes: [{ field: "dueDate", from: "2026-11-19", to: "2026-11-23" }] },
  { kind: "complete_task", task: { id: "task-dentist", name: "Call the dentist", project: null, dueDate: "2026-11-19" } },
  { kind: "create_event", ref: "new-3", title: "Whitewall deadline", date: "2026-12-17", startTime: null, endTime: null, description: null, project: whitewall },
  { kind: "trash_task", task: { id: "task-invoice", name: "Send the invoice to Acme", project: null, dueDate: null } },
];

test("stored steps are read back only when they're the kind the tools write (#310)", () => {
  assert.deepEqual(storedSteps(JSON.parse(JSON.stringify(STEPS))), STEPS);
  const subtask = { ...STEPS[1], ref: "new-4", title: "Add rate limits", parent: { ref: "new-2", name: "Harden sign-in" } };
  assert.deepEqual(storedSteps([...STEPS, subtask]), [...STEPS, subtask], "a subtask of a new task");
  const broken = [
    null,
    {},
    [],
    [{ kind: "delete_everything" }],
    [{ ...STEPS[0], name: "" }],
    [{ ...STEPS[1], dueDate: "next Friday" }],
    [{ kind: "update_task", task: releaseNotes, changes: [] }],
    [{ kind: "update_task", task: releaseNotes, changes: [{ field: "userId", from: "a", to: "b" }] }],
    [{ kind: "trash_task", task: { name: "No id", project: null, dueDate: null } }],
    [{ kind: "trash_task", task: { id: "task-invoice", name: "Without where it is" } }],
    Array.from({ length: 21 }, () => STEPS[3]),
    // Refs name an earlier step that makes that kind of item, and each step has its own.
    [STEPS[1]],
    [STEPS[1], STEPS[0]],
    [STEPS[0], { ...STEPS[1], project: { ref: "new-2", name: "Harden sign-in" } }],
    [STEPS[0], { ...STEPS[1], parent: whitewall }],
    [STEPS[0], { ...STEPS[4], ref: "new-1" }],
    [STEPS[0], { kind: "update_task", task: releaseNotes, changes: [{ field: "project", from: null, to: { ref: "new-9", name: "Nowhere" } }] }],
  ];
  for (const value of broken) assert.equal(storedSteps(value), null, JSON.stringify(value).slice(0, 120));
});

test("stored links point only at pages in the app (#310)", () => {
  const links = [
    { step: 0, title: "Whitewall", href: "/projects/proj-1" },
    { step: 5, title: "Send the invoice to Acme", href: "/trash" },
  ];
  assert.deepEqual(storedLinks(links), links);
  for (const href of ["//example.com", "/\\example.com", "https://example.com", "javascript:alert(1)"]) {
    assert.deepEqual(storedLinks([{ step: 0, title: "Whitewall", href }]), [], href);
  }
  assert.deepEqual(storedLinks(null), []);
  assert.deepEqual(storedLinks([{ step: -1, title: "Whitewall", href: "/projects/proj-1" }]), []);
});

test("a stored proposal shows as pending until its hour is up; steps it can't read show nothing (#310)", () => {
  const row = {
    id: "proposal-1",
    status: "PENDING" as const,
    steps: STEPS,
    applied: [],
    links: null,
    expiresAt: new Date("2026-11-19T18:20:00.000Z"),
    error: null,
  };
  assert.deepEqual(proposalView(row, new Date("2026-11-19T17:20:00.000Z")), {
    id: "proposal-1",
    state: "pending",
    expiresAt: "2026-11-19T18:20:00.000Z",
    steps: STEPS,
    applied: [],
    links: [],
    error: null,
  });
  assert.equal(proposalView(row, new Date("2026-11-19T18:20:00.000Z"))?.state, "expired");
  const failed = proposalView({ ...row, status: "FAILED", error: "Nothing was changed: “Call the dentist” isn't there any more." });
  assert.deepEqual([failed?.state, failed?.error], ["failed", "Nothing was changed: “Call the dentist” isn't there any more."]);
  assert.equal(proposalView({ ...row, steps: [{ kind: "nope" }] }), null);

  // Applied: which steps, and where to see them; an index past the steps is dropped.
  const links = [{ step: 3, title: "Call the dentist", href: "/tasks?task=task-dentist" }];
  const applied = proposalView({ ...row, status: "APPLIED", applied: [3, 9], links });
  assert.deepEqual([applied?.state, applied?.applied, applied?.links], ["applied", [3], links]);
});

test("Apply takes the ticked steps by index, or all of them without a body (#310)", () => {
  assert.deepEqual(parseApplyRequest(""), { ok: true, steps: null });
  assert.deepEqual(parseApplyRequest("  "), { ok: true, steps: null });
  assert.deepEqual(parseApplyRequest("{}"), { ok: true, steps: null });
  assert.deepEqual(parseApplyRequest('{"steps":[0,2]}'), { ok: true, steps: [0, 2] });
  // Whether they're this proposal's steps, and can go alone, is checked against it (choiceProblem).
  assert.deepEqual(parseApplyRequest('{"steps":[]}'), { ok: true, steps: [] });
  for (const raw of ["{", "null", "[0]", '{"steps":"all"}', '{"steps":[1.5]}', '{"steps":["0"]}', '{"steps":[0],"force":true}', JSON.stringify({ steps: Array.from({ length: 21 }, (_, index) => index) })]) {
    assert.deepEqual(parseApplyRequest(raw), { ok: false, error: "Choose which changes to apply." }, raw);
  }
});

test("a refused step says that nothing changed and why, naming the item (#310)", () => {
  assert.equal(refusalMessage(STEPS[3], { status: 404, error: "Task not found" }), "Nothing was changed: “Call the dentist” isn't there any more.");
  assert.equal(
    refusalMessage(STEPS[1], { status: 403, error: "You do not have permission to create tasks on this project." }),
    "Nothing was changed: you can no longer make changes in the project for “Harden sign-in”.",
  );
  assert.equal(refusalMessage(STEPS[4], { status: 400, error: "Invalid start date." }), "Nothing was changed: “Whitewall deadline” couldn't be saved (Invalid start date).");
});

test("a change to a task keeps every field it doesn't name, and a move drops the old project's assignee (#310)", () => {
  const current: CurrentTask = {
    title: "Write the release notes",
    description: null,
    status: "IN_PROGRESS",
    priority: "HIGH",
    recurrence: "WEEKLY",
    dueDate: parseTaskDueDateForStorage("2026-11-19"),
    projectId: "proj-mobile",
    assigneeId: "member-mobile-alex",
  };
  const created = new Map([["new-1", "proj-whitewall"]]);
  const idOf = (item: ItemRef | null) => (item ? (isExisting(item) ? item.id : (created.get(item.ref) ?? null)) : null);
  const unchanged = { ...current, description: "" };
  const change = (changes: Extract<ProposalStep, { kind: "update_task" }>["changes"]) => taskUpdateInput(current, { kind: "update_task", task: releaseNotes, changes }, idOf);

  assert.deepEqual(taskUpdateInput(current, { kind: "complete_task", task: releaseNotes }, idOf), { ...unchanged, status: "DONE" });
  assert.deepEqual(
    change([
      { field: "dueDate", from: "2026-11-19", to: "2026-11-23" },
      { field: "priority", from: "HIGH", to: "NONE" },
      { field: "title", from: "Write the release notes", to: "Write the 2.0 release notes" },
    ]),
    { ...unchanged, dueDate: parseTaskDueDateForStorage("2026-11-23"), priority: "NONE", title: "Write the 2.0 release notes" },
  );
  assert.deepEqual(
    change([
      { field: "dueDate", from: "2026-11-19", to: null },
      { field: "description", from: null, to: "Two chapters a week." },
      { field: "status", from: "IN_PROGRESS", to: "TODO" },
    ]),
    { ...unchanged, dueDate: null, description: "Two chapters a week.", status: "TODO" },
  );
  // A project this proposal creates comes by its ref; the assignee belonged to the old project.
  assert.deepEqual(change([{ field: "project", from: { id: "proj-mobile", name: "Mobile app launch" }, to: whitewall }]), {
    ...unchanged,
    projectId: "proj-whitewall",
    assigneeId: null,
  });
  assert.deepEqual(change([{ field: "project", from: { id: "proj-mobile", name: "Mobile app launch" }, to: null }]), { ...unchanged, projectId: null, assigneeId: null });
  assert.equal("labelIds" in change([{ field: "priority", from: "HIGH", to: "LOW" }]), false, "labels are left as they are");
});
