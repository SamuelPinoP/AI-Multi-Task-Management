import assert from "node:assert/strict";
import test from "node:test";
import { isTimeZone, sampleSchedule, shiftDate, wallClock } from "./guest-sample-core";

test("reads the visitor's own date and hour", () => {
  // 03:30 UTC on March 11 is still March 10 in New York.
  const now = new Date("2026-03-11T03:30:00Z");
  assert.deepEqual(wallClock(now, "UTC"), { date: "2026-03-11", hour: 3 });
  assert.deepEqual(wallClock(now, "America/New_York"), { date: "2026-03-10", hour: 23 });
  assert.deepEqual(wallClock(now, "Asia/Kolkata"), { date: "2026-03-11", hour: 9 });
});

test("moves dates across months and years", () => {
  assert.equal(shiftDate("2026-03-01", -1), "2026-02-28");
  assert.equal(shiftDate("2024-02-28", 1), "2024-02-29");
  assert.equal(shiftDate("2026-12-31", 1), "2027-01-01");
});

test("puts tasks around today and the review two hours from now", () => {
  const plan = sampleSchedule(new Date("2026-11-17T22:05:00Z"), "America/New_York");
  assert.equal(plan.today, "2026-11-17");
  assert.equal(plan.yesterday, "2026-11-16");
  assert.equal(plan.tomorrow, "2026-11-18");
  assert.deepEqual(plan.review, { date: "2026-11-17", start: "19:00", end: "19:30" });
  assert.deepEqual(plan.standup, { date: "2026-11-18", start: "09:30", end: "09:45" });
});

test("late in the evening the review is tomorrow morning", () => {
  const plan = sampleSchedule(new Date("2026-11-18T02:10:00Z"), "America/New_York");
  assert.equal(plan.today, "2026-11-17");
  assert.deepEqual(plan.review, { date: "2026-11-18", start: "10:00", end: "10:30" });
});

test("takes only real time zones", () => {
  assert.equal(isTimeZone("Europe/Madrid"), true);
  for (const value of ["", "Mars/Olympus", 42, null, undefined, "x".repeat(65)]) assert.equal(isTimeZone(value), false);
});
