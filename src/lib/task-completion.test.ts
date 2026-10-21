import assert from "node:assert/strict";
import test from "node:test";
import { nextCompletedAt } from "./task-completion";

const now = new Date("2026-10-21T12:00:00Z");

test("finishing a task stamps it now", () => {
  assert.equal(nextCompletedAt("TODO", "DONE", now), now);
  assert.equal(nextCompletedAt("IN_PROGRESS", "DONE", now), now);
});

test("editing a finished task keeps its completion date", () => {
  assert.equal(nextCompletedAt("DONE", "DONE", now), undefined);
});

test("reopening a task clears it", () => {
  assert.equal(nextCompletedAt("DONE", "TODO", now), null);
  assert.equal(nextCompletedAt("DONE", "IN_PROGRESS", now), null);
  assert.equal(nextCompletedAt("TODO", "IN_PROGRESS", now), null);
});
