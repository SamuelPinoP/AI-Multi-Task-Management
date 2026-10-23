import assert from "node:assert/strict";
import test from "node:test";
import { occurrencesInRange } from "./event-occurrences";
import { expandRecurringEventsForRange, repeatsOnDay, type RecurrenceValue } from "./recurrence";
import { formatTaskDayKey } from "./task-date-buckets";

// Range: Tuesday, October 20 through Saturday, October 24, 2026 (local dates).
const rangeStart = new Date(2026, 9, 20);
const rangeEnd = new Date(2026, 9, 24, 23, 59, 59, 999);

function event(
  id: string,
  fields: Partial<{
    startTime: string;
    endTime: string | null;
    recurrence: RecurrenceValue;
    hasStartTime: boolean;
    hasEndTime: boolean;
    repeatUntil: string | null;
  }>,
) {
  return { id, startTime: "2026-10-20T09:00:00.000Z", endTime: null, recurrence: "NONE" as RecurrenceValue, hasStartTime: true, hasEndTime: false, ...fields };
}

const days = (items: Array<{ startTime: string }>) => items.map((item) => formatTaskDayKey(item.startTime)).sort();
const localDay = (year: number, month: number, day: number, end = false) =>
  end ? new Date(year, month - 1, day, 23, 59, 59, 999) : new Date(year, month - 1, day);

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

test("a repeating event's end time ends each occurrence, not the series", () => {
  // Tuesdays 9:00-9:15 from October 6: it used to show only on October 6.
  const result = occurrencesInRange(
    [event("weekly", { startTime: "2026-10-06T09:00:00.000Z", endTime: "2026-10-06T09:15:00.000Z", hasEndTime: true, recurrence: "WEEKLY" })],
    rangeStart,
    rangeEnd,
  );
  assert.deepEqual(
    result.map((item) => [item.startTime, item.endTime]),
    [["2026-10-20T09:00:00.000Z", "2026-10-20T09:15:00.000Z"]],
  );
});

test("a series stops after its repeat-until day, including an occurrence late that day", () => {
  const until = (time: string) =>
    days(occurrencesInRange([event("daily", { startTime: `2026-10-06T${time}`, recurrence: "DAILY", repeatUntil: "2026-10-22T00:00:00.000Z" })], rangeStart, rangeEnd));
  assert.deepEqual(until("09:00:00.000Z"), ["2026-10-20", "2026-10-21", "2026-10-22"]);
  assert.deepEqual(until("23:30:00.000Z"), ["2026-10-20", "2026-10-21", "2026-10-22"]);
  // A series that ended before the range shows nothing.
  assert.deepEqual(
    occurrencesInRange([event("ended", { recurrence: "DAILY", startTime: "2026-10-01T09:00:00.000Z", repeatUntil: "2026-10-19T00:00:00.000Z" })], rangeStart, rangeEnd),
    [],
  );
});

test("an event saved before repeat-until existed keeps its series and each repeat ends that day", () => {
  // The migration copied the end date (December 31) into repeatUntil.
  const old = event("old-weekly", {
    startTime: "2026-10-06T09:00:00.000Z",
    endTime: "2026-12-31T09:15:00.000Z",
    hasEndTime: true,
    recurrence: "WEEKLY",
    repeatUntil: "2026-12-31T00:00:00.000Z",
  });
  assert.deepEqual(
    occurrencesInRange([old], rangeStart, rangeEnd).map((item) => [item.startTime, item.endTime]),
    [["2026-10-20T09:00:00.000Z", "2026-10-20T09:15:00.000Z"]],
  );
  assert.deepEqual(days(occurrencesInRange([old], localDay(2026, 12, 27), localDay(2027, 1, 9, true))), ["2026-12-29"]);
});

test("monthly repeats stay on their day, or the month's last day when it is shorter", () => {
  const monthly = [{ id: "rent", startTime: "2026-01-31T10:00:00.000Z", endTime: null, recurrence: "MONTHLY" as const }];
  const starts = expandRecurringEventsForRange(monthly, localDay(2026, 1, 1), localDay(2026, 5, 31, true)).map((item) => item.startTime);
  assert.deepEqual(starts, [
    "2026-01-31T10:00:00.000Z",
    "2026-02-28T10:00:00.000Z",
    "2026-03-31T10:00:00.000Z",
    "2026-04-30T10:00:00.000Z",
    "2026-05-31T10:00:00.000Z",
  ]);
});

test("a daily event that started years ago still shows (more than 1000 days back)", () => {
  const result = occurrencesInRange([event("habit", { startTime: "2020-01-01T07:00:00.000Z", recurrence: "DAILY" })], rangeStart, rangeEnd);
  assert.deepEqual(days(result), ["2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24"]);
});

test("a repeat that spans days shows on each day it covers, also when it began before the range", () => {
  // Fridays 18:00 to Sundays 10:00, from Friday, October 16.
  const weekend = event("weekend", {
    startTime: "2026-10-16T18:00:00.000Z",
    endTime: "2026-10-18T10:00:00.000Z",
    hasEndTime: true,
    recurrence: "WEEKLY",
  });
  const result = occurrencesInRange([weekend], rangeStart, rangeEnd);
  assert.deepEqual(days(result), ["2026-10-23", "2026-10-24"]);
  assert.equal(new Set(result.map((item) => item.id)).size, result.length);
  // Sunday, October 18 is covered by the occurrence that started on the 16th.
  assert.deepEqual(days(occurrencesInRange([weekend], localDay(2026, 10, 18), localDay(2026, 10, 19, true))), ["2026-10-18"]);
});

test("skipped days have no occurrence; the days around them still do (CAL-03)", () => {
  const standup = event("standup", { startTime: "2026-10-06T09:00:00.000Z", recurrence: "DAILY" });
  const result = occurrencesInRange([{ ...standup, skippedDates: ["2026-10-22T00:00:00.000Z", new Date("2026-10-24T00:00:00.000Z")] }], rangeStart, rangeEnd);
  assert.deepEqual(days(result), ["2026-10-20", "2026-10-21", "2026-10-23"]);
});

test("skipping a repeat that spans days removes every day it covers", () => {
  const weekend = event("weekend", {
    startTime: "2026-10-16T18:00:00.000Z",
    endTime: "2026-10-18T10:00:00.000Z",
    hasEndTime: true,
    recurrence: "WEEKLY",
  });
  const skipped = { ...weekend, skippedDates: ["2026-10-16T00:00:00.000Z"] };
  assert.deepEqual(days(occurrencesInRange([skipped], localDay(2026, 10, 16), localDay(2026, 10, 25, true))), ["2026-10-23", "2026-10-24", "2026-10-25"]);
});

test("skipped days don't matter to one-off events", () => {
  const once = { ...event("once", {}), skippedDates: ["2026-10-20T00:00:00.000Z"] };
  assert.deepEqual(days(occurrencesInRange([once], rangeStart, rangeEnd)), ["2026-10-20"]);
});

test("repeatsOnDay finds the days a series starts on, skipped or not", () => {
  const weekly = { id: "w", startTime: "2026-10-20T09:00:00.000Z", endTime: null, recurrence: "WEEKLY" as const, skippedDates: ["2026-10-27T00:00:00.000Z"] };
  assert.equal(repeatsOnDay(weekly, "2026-10-20"), true);
  assert.equal(repeatsOnDay(weekly, "2026-10-27"), true);
  assert.equal(repeatsOnDay(weekly, "2026-10-28"), false);
  assert.equal(repeatsOnDay(weekly, "2026-10-13"), false);
  assert.equal(repeatsOnDay({ ...weekly, repeatUntil: "2026-10-26T00:00:00.000Z" }, "2026-10-27"), false);
});
