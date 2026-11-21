import assert from "node:assert/strict";
import test from "node:test";
import {
  changeCount,
  choiceProblem,
  chosenSteps,
  formatClock,
  formatDayKey,
  needsNote,
  proposalRows,
  proposalState,
  stepChoices,
  stepNeeds,
  toggleStep,
  type ProposalStep,
} from "./proposals";

const TODAY = "2026-11-19";
const whitewall = { ref: "new-1", name: "Whitewall" };
const hardenSignIn = { ref: "new-2", name: "Harden sign-in" };
const LONG_DESCRIPTION = "Everything the launch needs, written out at length. ".repeat(4).trim();

const STEPS: ProposalStep[] = [
  { kind: "create_project", ref: "new-1", name: "Whitewall", description: "Security work so Multi is safe to launch." },
  { kind: "create_task", ref: "new-2", title: "Harden sign-in", description: "Limit sign-in attempts.", dueDate: "2026-12-17", priority: "HIGH", project: whitewall, parent: null },
  { kind: "complete_task", task: { id: "t2", name: "Call the dentist", project: null, dueDate: "2026-11-19" } },
  { kind: "create_task", ref: "new-3", title: "Add rate limits", description: null, dueDate: "2026-11-20", priority: "NONE", project: whitewall, parent: hardenSignIn },
  { kind: "create_event", ref: "new-4", title: "Whitewall deadline", date: "2026-12-17", startTime: null, endTime: null, description: null, project: whitewall },
  { kind: "create_event", ref: "new-5", title: "Kickoff", date: "2027-01-05", startTime: "09:00", endTime: "09:30", description: "Bring the plan.", project: null },
  {
    kind: "update_task",
    task: { id: "t1", name: "Write the release notes", project: null, dueDate: "2026-11-19" },
    changes: [
      { field: "dueDate", from: "2026-11-19", to: "2026-11-23" },
      { field: "priority", from: "HIGH", to: "NONE" },
      { field: "status", from: "TODO", to: "IN_PROGRESS" },
      { field: "project", from: null, to: whitewall },
      { field: "description", from: "Old", to: null },
    ],
  },
  { kind: "trash_task", task: { id: "t3", name: "Send the invoice to Acme", project: "Acme", dueDate: "2026-11-18" } },
  { kind: "create_project", ref: "new-6", name: "Launch plan", description: LONG_DESCRIPTION },
];

test("the card lists each new project with what goes in it, and says what happens to each item (#310)", () => {
  const rows = proposalRows(STEPS, TODAY);
  assert.deepEqual(
    rows.map((row) => [row.index, row.kind, row.verb, row.title, row.details, row.depth]),
    [
      [0, "project", "New project", "Whitewall", "Security work so Multi is safe to launch.", 0],
      [1, "task", "New task", "Harden sign-in", "Whitewall · Due Thu, Dec 17 · High", 1],
      // A subtask of a new task shows under it, one step further in.
      [3, "task", "New subtask", "Add rate limits", "Whitewall · Under Harden sign-in · Due tomorrow", 2],
      [4, "event", "New event", "Whitewall deadline", "Thursday, December 17 · All day · Whitewall", 1],
      // Moving a task into the new project puts it under the project too.
      [6, "update", "Change", "Write the release notes", "", 1],
      [2, "done", "Mark as done", "Call the dentist", "Personal · Due today", 0],
      // Another year shows its year.
      [5, "event", "New event", "Kickoff", "Tuesday, January 5, 2027 · 9:00 AM to 9:30 AM", 0],
      [7, "trash", "Move to the Trash", "Send the invoice to Acme", "Acme · Due yesterday", 0],
      // A long project description goes behind the details button.
      [8, "project", "New project", "Launch plan", "", 0],
    ],
  );
  assert.deepEqual(
    rows.map((row) => row.description),
    [null, "Limit sign-in attempts.", null, null, null, null, "Bring the plan.", null, LONG_DESCRIPTION],
  );
  assert.deepEqual(rows.find((row) => row.kind === "update")?.changes, [
    { label: "Due", from: "Thu, Nov 19", to: "Mon, Nov 23" },
    { label: "Priority", from: "High", to: "No priority" },
    { label: "Status", from: "To do", to: "In progress" },
    { label: "Project", from: "Personal", to: "Whitewall" },
    { label: "Description", from: "Old", to: "None" },
  ]);
  assert.equal(new Set(rows.map((row) => row.index)).size, STEPS.length, "every step once");
});

test("a step needs the new project or task it goes in, and leaving one out leaves out what's in it (#310)", () => {
  const steps = STEPS.slice(0, 5);
  assert.deepEqual(stepNeeds(steps), [[], [0], [], [1, 0], [0]]);
  assert.deepEqual(stepChoices(steps, new Set()), steps.map(() => ({ chosen: true, blockedBy: null })));
  assert.deepEqual(stepChoices(steps, new Set([0])), [
    { chosen: false, blockedBy: null },
    { chosen: false, blockedBy: 0 },
    { chosen: true, blockedBy: null },
    { chosen: false, blockedBy: 0 },
    { chosen: false, blockedBy: 0 },
  ]);
  assert.deepEqual(chosenSteps(steps, new Set([0])), [2]);
  assert.deepEqual(chosenSteps(steps, new Set([1])), [0, 2, 4], "the subtask goes with its parent");
  assert.equal(needsNote(steps[0]), "Needs the Whitewall project");
  assert.equal(needsNote(steps[1]), "Needs the Harden sign-in task");

  // Unticking, then ticking the project again brings back everything in it, even a task unticked first.
  let leftOut = toggleStep(steps, new Set(), 3);
  assert.deepEqual([...leftOut], [3]);
  leftOut = toggleStep(steps, leftOut, 2);
  leftOut = toggleStep(steps, leftOut, 0);
  assert.deepEqual(chosenSteps(steps, leftOut), []);
  leftOut = toggleStep(steps, leftOut, 0);
  assert.deepEqual(chosenSteps(steps, leftOut), [0, 1, 3, 4], "the dentist stays left out: it isn't in the project");
});

test("Apply refuses a choice the card can't make (#310)", () => {
  const steps = STEPS.slice(0, 5);
  assert.equal(choiceProblem(steps, [0, 1, 2, 3, 4]), null);
  assert.equal(choiceProblem(steps, [2]), null);
  assert.equal(choiceProblem(steps, [0, 1, 3]), null);
  assert.equal(choiceProblem(steps, []), "Choose at least one change to apply.");
  for (const chosen of [[0, 0], [5], [-1], [1.5]]) assert.equal(choiceProblem(steps, chosen), "Those aren't the changes this proposal has.", JSON.stringify(chosen));
  assert.equal(choiceProblem(steps, [1]), "“Harden sign-in” can't be applied without “Whitewall”.");
  assert.equal(choiceProblem(steps, [0, 3]), "“Add rate limits” can't be applied without “Harden sign-in”.");
});

test("dates read the same in every time zone, and times in 12-hour clock (#310)", () => {
  assert.equal(formatDayKey("2026-12-17"), "Thu, Dec 17");
  assert.equal(formatDayKey("2026-12-17", 2026), "Thu, Dec 17");
  assert.equal(formatDayKey("2027-01-01", 2026), "Fri, Jan 1, 2027");
  assert.equal(formatClock("00:05"), "12:05 AM");
  assert.equal(formatClock("12:00"), "12:00 PM");
  assert.equal(formatClock("15:00"), "3:00 PM");
  assert.equal(changeCount(1), "1 change");
  assert.equal(changeCount(4), "4 changes");
});

test("a pending proposal expires after its hour; the others keep their outcome (#310)", () => {
  const expiresAt = new Date("2026-11-19T18:20:00.000Z");
  assert.equal(proposalState("PENDING", expiresAt, new Date("2026-11-19T18:19:59.999Z")), "pending");
  assert.equal(proposalState("PENDING", expiresAt, expiresAt), "expired");
  assert.equal(proposalState("APPLIED", expiresAt, new Date("2026-11-20T00:00:00.000Z")), "applied");
  assert.equal(proposalState("CANCELLED", expiresAt, expiresAt), "cancelled");
  assert.equal(proposalState("FAILED", expiresAt, expiresAt), "failed");
});
