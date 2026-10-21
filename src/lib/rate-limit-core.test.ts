import assert from "node:assert/strict";
import test from "node:test";
import {
  clientIpFrom,
  RATE_LIMITS,
  retryAfterMinutes,
  retryAfterSeconds,
  slidingWindowCount,
  tooManyAttemptsMessage,
  windowStartFor,
} from "./rate-limit-core";

const MINUTE = 60 * 1000;

test("windows start on fixed boundaries", () => {
  assert.equal(windowStartFor(17 * MINUTE + 5000, 15 * MINUTE), 15 * MINUTE);
  assert.equal(windowStartFor(15 * MINUTE, 15 * MINUTE), 15 * MINUTE);
});

test("the previous window counts less as the current one goes on", () => {
  const base = { count: 2, previousCount: 10, windowStartMs: 0, windowMs: 10 * MINUTE };
  assert.equal(slidingWindowCount({ ...base, nowMs: 0 }), 12);
  assert.equal(slidingWindowCount({ ...base, nowMs: 5 * MINUTE }), 7);
  assert.equal(slidingWindowCount({ ...base, nowMs: 10 * MINUTE }), 2);
  assert.equal(slidingWindowCount({ ...base, nowMs: 20 * MINUTE }), 2);
});

test("retry times round up to whole seconds and minutes", () => {
  assert.equal(retryAfterSeconds(0, 14 * MINUTE + 30_000, 15 * MINUTE), 30);
  assert.equal(retryAfterSeconds(0, 15 * MINUTE, 15 * MINUTE), 1);
  assert.equal(retryAfterMinutes(30), 1);
  assert.equal(retryAfterMinutes(61), 2);
  assert.equal(tooManyAttemptsMessage("sign-in attempts", 600), "Too many sign-in attempts. Try again in 10 minutes.");
  assert.equal(tooManyAttemptsMessage("sign-in attempts", 20), "Too many sign-in attempts. Try again in 1 minute.");
});

test("reads the client IP from the first x-forwarded-for entry", () => {
  const headers = (values: Record<string, string>) => new Headers(values);
  assert.equal(clientIpFrom(headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" })), "203.0.113.7");
  assert.equal(clientIpFrom(headers({ "x-real-ip": "198.51.100.2" })), "198.51.100.2");
  assert.equal(clientIpFrom(headers({ "x-forwarded-for": "127.0.0.1" })), null);
  assert.equal(clientIpFrom(headers({ "x-forwarded-for": "::1" })), null);
  assert.equal(clientIpFrom(headers({})), null);
});

test("limits are tighter where abuse costs most", () => {
  assert.ok(RATE_LIMITS.loginAccount.limit < RATE_LIMITS.loginIp.limit);
  assert.ok(RATE_LIMITS.resetRequestAccount.limit <= RATE_LIMITS.resetRequestIp.limit);
  for (const rule of Object.values(RATE_LIMITS)) {
    assert.match(rule.name, /^[a-z-]+$/);
    assert.ok(rule.limit > 0 && rule.windowMs >= MINUTE);
  }
});
