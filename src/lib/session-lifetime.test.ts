import assert from "node:assert/strict";
import test from "node:test";
import { renewedSessionEnd, sessionEndsAt, sessionLimit, SESSION_IDLE_DAYS, SESSION_MAX_DAYS } from "./session-lifetime";

const DAY = 24 * 60 * 60 * 1000;
const login = new Date("2026-11-05T12:00:00Z");
const after = (days: number) => new Date(login.getTime() + days * DAY);

test("a session lasts 30 days without use, and a year at most", () => {
  assert.equal(SESSION_IDLE_DAYS, 30);
  assert.equal(SESSION_MAX_DAYS, 365);
  assert.deepEqual(sessionEndsAt(login, login), after(30));
  assert.deepEqual(sessionLimit(login), after(365));
  // Near the limit, the limit wins.
  assert.deepEqual(sessionEndsAt(login, after(350)), after(365));
  assert.deepEqual(sessionEndsAt(login, after(400)), after(365));
});

test("using a session pushes its end back, at most once a day", () => {
  const fresh = { createdAt: login, expiresAt: after(30) };
  assert.equal(renewedSessionEnd(fresh, after(0.5)), null);
  assert.equal(renewedSessionEnd(fresh, new Date(after(1).getTime() - 1)), null);
  assert.deepEqual(renewedSessionEnd(fresh, after(1)), after(31));
  // Used again after 28 quiet days: another 30 from now.
  assert.deepEqual(renewedSessionEnd(fresh, after(28)), after(58));
});

test("renewal never goes past a year after logging in", () => {
  const old = { createdAt: login, expiresAt: after(340) };
  assert.deepEqual(renewedSessionEnd(old, after(345)), after(365));
  // Already at the limit: nothing to write.
  assert.equal(renewedSessionEnd({ createdAt: login, expiresAt: after(365) }, after(360)), null);
});

test("sessions from before renewal, which end 7 days after login, renew like any other", () => {
  const legacy = { createdAt: login, expiresAt: after(7) };
  assert.deepEqual(renewedSessionEnd(legacy, after(3)), after(33));
});
