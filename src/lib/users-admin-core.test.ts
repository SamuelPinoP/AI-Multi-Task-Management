import assert from "node:assert/strict";
import test from "node:test";
import {
  activityLabel,
  activityTotals,
  fullDateTime,
  isNewAccount,
  latestOf,
  madeSummary,
  plural,
  relativeDay,
  sessionLastUsed,
  signInLabel,
  signsInWith,
  usersSummary,
} from "./users-admin-core";

const at = (iso: string) => new Date(iso);

test("picks the latest moment, ignoring missing ones", () => {
  assert.equal(latestOf(), null);
  assert.equal(latestOf(null, undefined), null);
  assert.deepEqual(latestOf(at("2026-11-01T00:00:00Z"), null, at("2026-11-03T00:00:00Z"), at("2026-11-02T00:00:00Z")), at("2026-11-03T00:00:00Z"));
});

test("dates a session's last use from its renewed end, never before it started", () => {
  // Renewed to 30 days after its last use on November 10.
  assert.deepEqual(sessionLastUsed(at("2026-11-01T09:00:00Z"), at("2026-12-10T09:00:00Z")), at("2026-11-10T09:00:00Z"));
  // Never renewed: it ends 30 days after it started, so the start is the best guess.
  assert.deepEqual(sessionLastUsed(at("2026-11-01T09:00:00Z"), at("2026-12-01T09:00:00Z")), at("2026-11-01T09:00:00Z"));
  assert.equal(sessionLastUsed(null, null), null);
});

test("sums up what someone made, leaving out what they made none of", () => {
  assert.deepEqual(madeSummary({ tasks: 19, notes: 0, events: 1, projects: 1, messages: 0 }), ["19 tasks", "1 event", "1 project"]);
  assert.deepEqual(madeSummary({ tasks: 1, notes: 2, events: 0, projects: 0, messages: 1234 }), ["1 task", "2 notes", "1,234 chat messages"]);
  assert.deepEqual(madeSummary({ tasks: 0, notes: 0, events: 0, projects: 0, messages: 0 }), []);
  assert.equal(plural(1, "entry", "entries"), "1 entry");
  assert.equal(plural(0, "entry", "entries"), "0 entries");
});

test("says how an account signs in", () => {
  assert.equal(signsInWith({ hasPassword: true, hasGoogle: false }), "Password");
  assert.equal(signsInWith({ hasPassword: false, hasGoogle: true }), "Google");
  assert.equal(signsInWith({ hasPassword: true, hasGoogle: true }), "Password and Google");
  assert.equal(signsInWith({ hasPassword: false, hasGoogle: false }), "No way to sign in");
});

test("labels each sign-in, and an account's first one as its sign-up", () => {
  assert.equal(signInLabel("PASSWORD", false), "Password");
  assert.equal(signInLabel("GOOGLE", false), "Google");
  assert.equal(signInLabel("GUEST", false), "Guest");
  assert.equal(signInLabel("PASSWORD", true), "Signed up with a password");
  assert.equal(signInLabel("GOOGLE", true), "Signed up with Google");
  assert.equal(signInLabel("GUEST", true), "Started a guest workspace");
});

test("names actions without their titles, and totals them most frequent first", () => {
  assert.equal(activityLabel("CREATED_TASK"), "Created a task");
  assert.equal(activityLabel("CREATED_EVENT"), "Created an event");
  assert.equal(activityLabel("COMMENTED"), "Wrote in a project chat");
  assert.deepEqual(
    activityTotals([
      { action: "COMPLETED_TASK", count: 5 },
      { action: "CREATED_TASK", count: 19 },
      { action: "DELETED_ITEM", count: 0 },
      { action: "CREATED_PROJECT", count: 1 },
      { action: "CREATED_EVENT", count: 1 },
    ]),
    ["Created 19 tasks", "Completed 5 tasks", "Created 1 event", "Created 1 project"],
  );
  assert.deepEqual(activityTotals([]), []);
});

test("counts accounts, confirmed ones, recent ones and new ones", () => {
  const now = at("2026-11-15T12:00:00Z");
  const users = [
    { signedUpAt: at("2026-11-14T12:00:00Z"), confirmedAt: at("2026-11-14T12:05:00Z"), lastActiveAt: at("2026-11-15T10:00:00Z") },
    { signedUpAt: at("2026-07-08T12:00:00Z"), confirmedAt: null, lastActiveAt: at("2026-07-16T12:00:00Z") },
    { signedUpAt: at("2026-06-13T12:00:00Z"), confirmedAt: at("2026-06-13T12:00:00Z"), lastActiveAt: at("2026-11-08T12:00:00Z") },
    { signedUpAt: at("2026-11-08T11:59:00Z"), confirmedAt: null, lastActiveAt: null },
  ];
  assert.deepEqual(usersSummary(users, now), { accounts: 4, confirmed: 2, activeThisWeek: 2, newThisWeek: 1 });
  assert.equal(isNewAccount(at("2026-11-08T12:00:01Z"), now), true);
  assert.equal(isNewAccount(at("2026-11-08T12:00:00Z"), now), false);
});

test("words moments by the reader's calendar day", () => {
  const now = at("2026-11-15T17:00:00Z"); // 12:00 PM in New York
  const zone = "America/New_York";
  assert.equal(relativeDay(at("2026-11-15T14:05:00Z"), now, zone), "Today, 9:05 AM");
  assert.equal(relativeDay(at("2026-11-15T03:00:00Z"), now, zone), "Yesterday, 10:00 PM");
  assert.equal(relativeDay(at("2026-11-03T15:00:00Z"), now, zone), "Nov 3");
  assert.equal(relativeDay(at("2025-11-03T15:00:00Z"), now, zone), "Nov 3, 2025");
  // The same moment is still "today" in UTC.
  assert.equal(relativeDay(at("2026-11-15T03:00:00Z"), now, "UTC"), "Today, 3:00 AM");
  assert.equal(fullDateTime(at("2026-11-03T15:04:00Z"), zone), "Nov 3, 2026, 10:04 AM");
});
