import assert from "node:assert/strict";
import test from "node:test";
import { isValidTimeZone, wallClockNow } from "./user-time";

function fields(date: Date) {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours(), date.getMinutes()];
}

test("New York's wall clock is still the previous day late in the evening", () => {
  // 03:30 UTC on October 21 is 11:30 PM on October 20 in New York (EDT).
  const now = new Date("2026-10-21T03:30:00.000Z");
  assert.deepEqual(fields(wallClockNow("America/New_York", now)), [2026, 10, 20, 23, 30]);
});

test("zones ahead of UTC are already on the next day", () => {
  // 20:00 UTC on October 20 is 10:00 AM on October 21 in Kiritimati (UTC+14).
  const now = new Date("2026-10-20T20:00:00.000Z");
  assert.deepEqual(fields(wallClockNow("Pacific/Kiritimati", now)), [2026, 10, 21, 10, 0]);
});

test("midnight reads as hour 0, not 24", () => {
  const now = new Date("2026-10-20T04:00:00.000Z");
  assert.deepEqual(fields(wallClockNow("America/New_York", now)), [2026, 10, 20, 0, 0]);
});

test("without a valid time zone the real time is used", () => {
  const now = new Date("2026-10-21T03:30:00.000Z");
  assert.equal(wallClockNow(null, now), now);
  assert.equal(wallClockNow("", now), now);
  assert.equal(wallClockNow("Not/AZone", now), now);
});

test("isValidTimeZone accepts IANA names only", () => {
  assert.equal(isValidTimeZone("America/New_York"), true);
  assert.equal(isValidTimeZone("UTC"), true);
  assert.equal(isValidTimeZone("Mars/Olympus_Mons"), false);
  assert.equal(isValidTimeZone(42), false);
  assert.equal(isValidTimeZone("x".repeat(65)), false);
});
