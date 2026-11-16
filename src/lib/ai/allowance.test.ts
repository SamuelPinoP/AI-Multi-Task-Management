import assert from "node:assert/strict";
import test from "node:test";
import { allowanceFor, exhaustedCap, nextQuotaReset, quotaDayStart, untilReset } from "./allowance";

const at = (iso: string) => new Date(iso);
const iso = (date: Date) => date.toISOString();

test("the quota day starts at midnight Pacific time, when Gemini resets", () => {
  // November: Pacific Standard Time, UTC-8.
  assert.equal(iso(quotaDayStart(at("2026-11-16T15:00:00Z"))), "2026-11-16T08:00:00.000Z");
  assert.equal(iso(quotaDayStart(at("2026-11-16T07:59:59Z"))), "2026-11-15T08:00:00.000Z", "still the day before in California");
  assert.equal(iso(nextQuotaReset(at("2026-11-16T15:00:00Z"))), "2026-11-17T08:00:00.000Z");
  // July: Pacific Daylight Time, UTC-7.
  assert.equal(iso(quotaDayStart(at("2026-07-01T12:00:00Z"))), "2026-07-01T07:00:00.000Z");
});

test("days the clocks change are 23 and 25 hours long", () => {
  // March 8, 2026: clocks go forward at 2 AM.
  assert.equal(iso(quotaDayStart(at("2026-03-08T12:00:00Z"))), "2026-03-08T08:00:00.000Z");
  assert.equal(iso(nextQuotaReset(at("2026-03-08T12:00:00Z"))), "2026-03-09T07:00:00.000Z");
  // November 1, 2026: clocks go back at 2 AM.
  assert.equal(iso(quotaDayStart(at("2026-11-01T12:00:00Z"))), "2026-11-01T07:00:00.000Z");
  assert.equal(iso(nextQuotaReset(at("2026-11-01T12:00:00Z"))), "2026-11-02T08:00:00.000Z");
});

test("the allowance never shows less than nothing left", () => {
  const now = at("2026-11-16T15:00:00Z");
  const allowance = allowanceFor({ user: 43, app: 120 }, { userDailyRequests: 40, appDailyRequests: 400 }, now);
  assert.deepEqual(allowance, {
    user: { used: 43, limit: 40, remaining: 0 },
    app: { used: 120, limit: 400, remaining: 280 },
    resetsAt: "2026-11-17T08:00:00.000Z",
  });
});

test("the person's own cap is reported before the app's", () => {
  const now = at("2026-11-16T15:00:00Z");
  const caps = { userDailyRequests: 10, appDailyRequests: 100 };
  assert.equal(exhaustedCap(allowanceFor({ user: 9, app: 99 }, caps, now)), null);
  assert.equal(exhaustedCap(allowanceFor({ user: 10, app: 100 }, caps, now)), "user");
  assert.equal(exhaustedCap(allowanceFor({ user: 2, app: 100 }, caps, now)), "app");
  assert.equal(exhaustedCap(allowanceFor({ user: 0, app: 0 }, { userDailyRequests: 10, appDailyRequests: 0 }, now)), "app", "a cap of 0 stops every request");
});

test("says roughly when the allowance comes back", () => {
  const caps = { userDailyRequests: 10, appDailyRequests: 100 };
  const afternoon = at("2026-11-16T15:00:00Z");
  assert.equal(untilReset(allowanceFor({ user: 10, app: 0 }, caps, afternoon), afternoon), "about 17 hours");
  const lateNight = at("2026-11-17T07:20:00Z");
  assert.equal(untilReset(allowanceFor({ user: 10, app: 0 }, caps, lateNight), lateNight), "about an hour");
});
