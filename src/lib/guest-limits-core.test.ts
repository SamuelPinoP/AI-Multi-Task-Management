import assert from "node:assert/strict";
import test from "node:test";
import {
  ACCOUNT_REQUIRED_CODE,
  accountRequiredRefusal,
  GUEST_LIMIT_CODE,
  GUEST_LIMITS,
  guestHasRoom,
  guestLeft,
  guestLimitRefusal,
  guestRefusalReason,
  guestSignupCopy,
  isGuestLimitKind,
} from "./guest-limits-core";

const empty = { tasks: 0, events: 0, notes: 0, projects: 0 };

test("guests get 5 tasks, 2 events, 3 notes and 1 project", () => {
  assert.deepEqual(GUEST_LIMITS, { tasks: 5, events: 2, notes: 3, projects: 1 });
});

test("counts what is left, never below zero", () => {
  assert.equal(guestLeft(empty, "tasks"), 5);
  assert.equal(guestLeft({ ...empty, tasks: 3 }, "tasks"), 2);
  assert.equal(guestLeft({ ...empty, events: 2 }, "events"), 0);
  // An account that was a guest before the limits existed can hold more than they allow.
  assert.equal(guestLeft({ ...empty, notes: 9 }, "notes"), 0);
});

test("the last one fits; one more doesn't", () => {
  assert.equal(guestHasRoom({ ...empty, tasks: 4 }, "tasks"), true);
  assert.equal(guestHasRoom({ ...empty, tasks: 5 }, "tasks"), false);
  assert.equal(guestHasRoom({ ...empty, projects: 0 }, "projects"), true);
  assert.equal(guestHasRoom({ ...empty, projects: 1 }, "projects"), false);
  assert.equal(guestHasRoom({ ...empty, tasks: 3 }, "tasks", 2), true);
  assert.equal(guestHasRoom({ ...empty, tasks: 3 }, "tasks", 3), false);
});

test("names each limit in the pop-up, in the singular for one", () => {
  assert.equal(guestSignupCopy("tasks").title, "You've used your 5 guest tasks");
  assert.equal(guestSignupCopy("events").title, "You've used your 2 guest events");
  assert.equal(guestSignupCopy("notes").title, "You've used your 3 guest notes");
  assert.equal(guestSignupCopy("projects").title, "Guest workspaces have 1 project");
  assert.match(guestSignupCopy("tasks").description, /as many as you like/);
});

test("tells guests their work comes with them when they sign up (#459)", () => {
  assert.match(guestSignupCopy("tasks").description, /Everything you made here comes with you\./);
  assert.match(guestSignupCopy("signup").description, /everything you made here comes with you\./);
  assert.match(guestSignupCopy("ai").description, /everything you made here comes with you\./);
});

test("says what only accounts can do", () => {
  assert.equal(guestSignupCopy("ai").title, "The AI needs a free account");
  assert.equal(guestSignupCopy("people").title, "Inviting people needs a free account");
  assert.equal(guestSignupCopy("ai-apps").title, "Connecting AI apps needs a free account");
  assert.equal(guestSignupCopy("signup").title, "Keep your work with a free account");
});

test("the API's refusals carry a code and a reason the browser can read back", () => {
  const limit = guestLimitRefusal("tasks");
  assert.deepEqual(limit, { error: "Guest workspaces hold 5 tasks. Sign up free to add more.", code: GUEST_LIMIT_CODE, reason: "tasks" });
  assert.equal(guestLimitRefusal("projects").error, "Guest workspaces hold 1 project. Sign up free to add more.");
  assert.equal(guestRefusalReason(limit), "tasks");

  const account = accountRequiredRefusal("people");
  assert.equal(account.code, ACCOUNT_REQUIRED_CODE);
  assert.equal(guestRefusalReason(account), "people");
});

test("ignores anything else", () => {
  for (const body of [null, undefined, "GUEST_LIMIT", 403, {}, { error: "Title is required" }, { code: GUEST_LIMIT_CODE }, { code: GUEST_LIMIT_CODE, reason: "boards" }, { code: "OTHER", reason: "tasks" }, { code: ACCOUNT_REQUIRED_CODE, reason: "toString" }]) {
    assert.equal(guestRefusalReason(body), null);
  }
  assert.equal(isGuestLimitKind("constructor"), false);
});
