import assert from "node:assert/strict";
import test from "node:test";
import { occurrencesInRange } from "./event-occurrences";
import { formatTaskDayKey } from "./task-date-buckets";

// Range: Tuesday, October 20 through Saturday, October 24, 2026 (local dates).
const rangeStart = new Date(2026, 9, 20);
const rangeEnd = new Date(2026, 9, 24, 23, 59, 59, 999);

function event(id: string, fields: Partial<{ startTime: string; endTime: string | null; recurrence: "NONE" | "DAILY" | "WEEKLY"; hasStartTime: boolean }>) {
  return { id, startTime: "2026-10-20T09:00:00.000Z", endTime: null, recurrence: "NONE" as const, hasStartTime: true, hasEndTime: false, ...fields };
}

const days = (items: Array<{ startTime: string }>) => items.map((item) => formatTaskDayKey(item.startTime)).sort();

test("a daily event that started weeks ago appears on every day of the range", () => {
  const result = occurrencesInRange([event("standup", { startTime: "2026-10-06T09:00:00.000Z", recurrence: "DAILY" })], rangeStart, rangeEnd);
  assert.deepEqual(days(result), ["2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24"]);
  assert.ok(result.every((item) => item.sourceEventId === "standup"));
});

test("a one-off event that spans days appears on each day, all-day after the first", () => {
  const result = occurrencesInRange(
    [event("conference", { startTime: "2026-10-19T00:00:00.000Z", endTime: "2026-10-21T00:00:00.000Z", hasStartTime: false })],
    rangeStart,
    rangeEnd,
  );
  // Its first day (the 19th) is before the range, so only the 20th and 21st show.
  assert.deepEqual(days(result), ["2026-10-20", "2026-10-21"]);
  assert.ok(result.every((item) => item.hasStartTime === false && item.sourceEventId === "conference"));
});

test("a timed event over two days keeps its start time on the first day", () => {
  const result = occurrencesInRange(
    [event("trip", { startTime: "2026-10-23T18:00:00.000Z", endTime: "2026-10-26T10:00:00.000Z" })],
    rangeStart,
    rangeEnd,
  );
  assert.deepEqual(days(result), ["2026-10-23", "2026-10-24"]);
  assert.equal(result.find((item) => item.id === "trip")?.hasStartTime, true);
});

test("events outside the range are left out", () => {
  assert.deepEqual(occurrencesInRange([event("old", { startTime: "2026-10-01T09:00:00.000Z" })], rangeStart, rangeEnd), []);
  assert.deepEqual(occurrencesInRange([event("later", { startTime: "2026-10-30T09:00:00.000Z" })], rangeStart, rangeEnd), []);
});
