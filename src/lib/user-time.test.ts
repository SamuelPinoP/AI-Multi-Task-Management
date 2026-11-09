import assert from "node:assert/strict";
import test from "node:test";
import { dayKeyInZone, formatInstant, isValidTimeZone, toWallClock } from "./user-time";

function fields(date: Date) {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours(), date.getMinutes()];
}

test("New York's wall clock is still the previous day late in the evening", () => {
  // 03:30 UTC on October 21 is 11:30 PM on October 20 in New York (EDT).
  const now = new Date("2026-10-21T03:30:00.000Z");
  assert.deepEqual(fields(toWallClock("America/New_York", now)), [2026, 10, 20, 23, 30]);
});

test("zones ahead of UTC are already on the next day", () => {
  // 20:00 UTC on October 20 is 10:00 AM on October 21 in Kiritimati (UTC+14).
  const now = new Date("2026-10-20T20:00:00.000Z");
  assert.deepEqual(fields(toWallClock("Pacific/Kiritimati", now)), [2026, 10, 21, 10, 0]);
});

test("midnight reads as hour 0, not 24", () => {
  const now = new Date("2026-10-20T04:00:00.000Z");
  assert.deepEqual(fields(toWallClock("America/New_York", now)), [2026, 10, 20, 0, 0]);
});

test("without a valid time zone the real time is used", () => {
  const now = new Date("2026-10-21T03:30:00.000Z");
  assert.equal(toWallClock(null, now), now);
  assert.equal(toWallClock("", now), now);
  assert.equal(toWallClock("Not/AZone", now), now);
});

test("isValidTimeZone accepts IANA names only", () => {
  assert.equal(isValidTimeZone("America/New_York"), true);
  assert.equal(isValidTimeZone("UTC"), true);
  assert.equal(isValidTimeZone("Mars/Olympus_Mons"), false);
  assert.equal(isValidTimeZone(42), false);
  assert.equal(isValidTimeZone("x".repeat(65)), false);
});

const messageTime = { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" } as const;

test("formatInstant shows a moment in the reader's zone, in English, whatever the runtime's zone (#381)", () => {
  // 00:27 UTC on November 8 is 7:27 PM on November 7 in New York (EST).
  const instant = "2026-11-08T00:27:00.000Z";
  assert.equal(formatInstant(instant, "America/New_York", messageTime), "Nov 7, 7:27 PM");
  assert.equal(formatInstant(new Date(instant), "Pacific/Kiritimati", messageTime), "Nov 8, 2:27 PM");
  assert.equal(formatInstant(instant, "America/New_York", { dateStyle: "medium", timeStyle: "short" }), "Nov 7, 2026, 7:27 PM");
});

test("formatInstant uses UTC without a valid zone, as the server does before the tz cookie exists", () => {
  const instant = "2026-11-08T00:27:00.000Z";
  assert.equal(formatInstant(instant, null, messageTime), "Nov 8, 12:27 AM");
  assert.equal(formatInstant(instant, undefined, messageTime), "Nov 8, 12:27 AM");
  assert.equal(formatInstant(instant, "Not/AZone", messageTime), "Nov 8, 12:27 AM");
});

test("dayKeyInZone gives the reader's calendar day", () => {
  const instant = new Date("2026-11-08T00:27:00.000Z");
  assert.equal(dayKeyInZone("America/New_York", instant), "2026-11-07");
  assert.equal(dayKeyInZone("Pacific/Kiritimati", new Date("2026-10-20T20:00:00.000Z")), "2026-10-21");
  assert.equal(dayKeyInZone(null, instant), "2026-11-08");
  assert.equal(dayKeyInZone("Not/AZone", instant), "2026-11-08");
});
