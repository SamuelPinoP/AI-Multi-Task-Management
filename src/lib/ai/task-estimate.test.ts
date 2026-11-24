import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { ESTIMATE_STEPS, SPLIT_OVER, stepMinutes } from "@/lib/estimates";
import { SPLIT_STEPS, estimateBody, estimateFields, estimateProblem, withEstimate } from "./task-estimate";

const SOON = { size: "15 min" as const, reason: "One call to book a visit." };
const SOON_SECTION = "## Estimate\n\n**15 min** · AI estimate\nOne call to book a visit.";

test("a subtask that splits bigger work takes one of the steps up to 2 days", () => {
  assert.deepEqual(SPLIT_STEPS, ["15 min", "30 min", "1 h", "2 h", "4 h", "1 day", "2 days"]);
  assert.ok(SPLIT_STEPS.every((step) => stepMinutes(step) <= SPLIT_OVER));
  assert.ok(ESTIMATE_STEPS.filter((step) => !SPLIT_STEPS.includes(step)).every((step) => stepMinutes(step) > SPLIT_OVER));
});

test("a new task's details come first, as they are, and the AI's estimate after them", () => {
  assert.equal(withEstimate(null, SOON), SOON_SECTION);
  assert.equal(withEstimate("", SOON), SOON_SECTION);
  assert.equal(withEstimate("The kitchen sink leaks.\nBefore Friday.", SOON), `The kitchen sink leaks.\nBefore Friday.\n\n${SOON_SECTION}`);
  // Sections the model wrote stay, in order; an Estimate section of its own gives way to the AI's.
  assert.equal(withEstimate("Intro\n\n## Estimate\n\n3 h\n\n## Notes\n\nBring the key.", SOON), `Intro\n\n## Notes\n\nBring the key.\n\n${SOON_SECTION}`);
  // Without an estimate, as for a subtask of a task without one, the details stay exactly as they were.
  assert.equal(withEstimate("  Keep my spacing  ", undefined), "  Keep my spacing  ");
  assert.equal(withEstimate(null, undefined), null);
});

test("the reason stays one line, and work over 2 days says it's worth splitting, unless it's a subtask", () => {
  assert.equal(estimateBody({ size: "2 days", reason: "- Two\n  parts" }), "**2 days** · AI estimate\nTwo parts");
  assert.equal(estimateBody({ size: "3 days", reason: "## Big" }), "**3 days** · AI estimate\n\\## Big\n\nMore than 2 days of work: worth splitting into subtasks.");
  assert.equal(estimateBody({ size: "3 days", reason: "Big" }, { subtask: true }), "**3 days** · AI estimate\nBig");
});

test("work over 2 days needs its split, unless it's a subtask; shorter work gets none", () => {
  const split = [
    { title: "One", size: "1 day" as const, reason: "Half." },
    { title: "Two", size: "2 days" as const, reason: "The rest." },
  ];
  const long = { size: "1 week" as const, reason: "A lot." };
  assert.match(estimateProblem({ estimate: long }, "task") ?? "", /over 2 days: give split, 2 to 5 subtasks of 2 days or less/);
  assert.equal(estimateProblem({ estimate: long, split }, "task"), null);
  assert.equal(estimateProblem({ estimate: long, parent: "Move house" }, "task"), null);
  assert.match(estimateProblem({ estimate: SOON, split }, "task") ?? "", /only for an estimate over 2 days\. .* with this task's ref as the parent/);
  assert.match(estimateProblem({ estimate: SOON, split }, "ticket") ?? "", /with this ticket's ref as the parent/);
  assert.equal(estimateProblem({ estimate: SOON }, "task"), null);
});

test("the model gives one of the fixed steps with a reason, and each subtask of a split its own", () => {
  const schema = z.strictObject(estimateFields("task"));
  assert.equal(schema.safeParse({ estimate: SOON }).success, true);
  assert.equal(schema.safeParse({}).success, false, "every task the AI creates has one");
  assert.equal(schema.safeParse({ estimate: { size: "20 min", reason: "Close to 15." } }).success, false);
  assert.equal(schema.safeParse({ estimate: { size: "15 min", reason: "x".repeat(201) } }).success, false);
  assert.equal(schema.safeParse({ estimate: { ...SOON, minutes: 15 } }).success, false);
  const part = { title: "Pack", size: "2 days", reason: "Every room." };
  assert.equal(schema.safeParse({ estimate: SOON, split: [part, part] }).success, true);
  assert.equal(schema.safeParse({ estimate: SOON, split: [part, { ...part, size: "1 week" }] }).success, false);
  assert.equal(schema.safeParse({ estimate: SOON, split: [part, { title: "Unpack" }] }).success, false);
  // A ticket's estimate counts tests and review; a plain task's is about whatever the person asked.
  assert.match(String(estimateFields("ticket").estimate.description), /tests and review included/);
  assert.doesNotMatch(String(estimateFields("task").estimate.description), /tests and review/);
});
