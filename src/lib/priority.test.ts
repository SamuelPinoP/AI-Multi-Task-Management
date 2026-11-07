import assert from "node:assert/strict";
import test from "node:test";
import {
  comparePriority,
  isPressingPriority,
  isPriority,
  PRIORITIES,
  PRIORITY_MENU_ORDER,
  priorityBadgeLabels,
  priorityLabels,
  priorityRank,
} from "./priority";

test("five priorities, most urgent first", () => {
  assert.deepEqual([...PRIORITIES], ["URGENT", "HIGH", "MEDIUM", "LOW", "NONE"]);
  assert.equal(priorityRank("URGENT"), 0);
  assert.equal(priorityRank("NONE"), 4);
});

test("sorting puts Urgent first and No priority last", () => {
  const sorted = (["LOW", "NONE", "URGENT", "MEDIUM", "HIGH"] as const).slice().sort(comparePriority);
  assert.deepEqual(sorted, ["URGENT", "HIGH", "MEDIUM", "LOW", "NONE"]);
});

test("menus list No priority first, then most urgent, and every priority once", () => {
  assert.deepEqual([...PRIORITY_MENU_ORDER], ["NONE", "URGENT", "HIGH", "MEDIUM", "LOW"]);
  assert.deepEqual([...PRIORITY_MENU_ORDER].sort(), [...PRIORITIES].sort());
});

test("labels exist for every priority, and No priority has no badge", () => {
  for (const priority of PRIORITIES) assert.ok(priorityLabels[priority]);
  assert.equal(priorityLabels.NONE, "No priority");
  assert.equal(priorityBadgeLabels.NONE, "");
  assert.equal(priorityBadgeLabels.MEDIUM, "Med");
});

test("only the five values are priorities", () => {
  for (const priority of PRIORITIES) assert.equal(isPriority(priority), true);
  for (const value of ["urgent", "CRITICAL", "", null, undefined, 3]) assert.equal(isPriority(value), false);
});

test("Urgent and High are the pressing ones", () => {
  assert.deepEqual(PRIORITIES.filter(isPressingPriority), ["URGENT", "HIGH"]);
});
