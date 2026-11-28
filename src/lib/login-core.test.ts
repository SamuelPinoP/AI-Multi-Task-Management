import assert from "node:assert/strict";
import test from "node:test";
import { loginFailureMessage, pageAfterGuestLogin } from "./login-core";

test("a failed login says what went wrong, the same on the page and in the pop-up (#543)", () => {
  assert.equal(loginFailureMessage("invalid"), "Incorrect email, username or password.");
  assert.equal(loginFailureMessage("missing"), "Enter your email or username, and your password.");
  assert.equal(loginFailureMessage("unconfirmed"), "Your email isn't confirmed yet. Open the link we sent you.");
  // The page reads the wait from its address, the pop-up from the JSON answer.
  assert.equal(loginFailureMessage("rate-limited", "600"), "Too many sign-in attempts. Try again in 10 minutes.");
  assert.equal(loginFailureMessage("rate-limited", 60), "Too many sign-in attempts. Try again in 1 minute.");
  assert.equal(loginFailureMessage("rate-limited"), "Too many sign-in attempts. Try again in 1 minute.");
  assert.equal(loginFailureMessage(undefined), null);
  assert.equal(loginFailureMessage("logged-out"), null);
});

test("logging in from a guest workspace lands on the same page of the account (#543)", () => {
  for (const page of ["/", "/tasks", "/tasks/board", "/projects", "/notes", "/events/calendar", "/tree", "/chats", "/ai", "/trash"]) {
    assert.equal(pageAfterGuestLogin(page), page);
  }
});

test("a page of something the guest made lands on its list, which the account has too", () => {
  assert.equal(pageAfterGuestLogin("/projects/cm1guestproject"), "/projects");
  assert.equal(pageAfterGuestLogin("/projects/cm1guestproject/board"), "/projects");
  assert.equal(pageAfterGuestLogin("/projects/cm1guestproject/chat"), "/projects");
  assert.equal(pageAfterGuestLogin("/tasks/cm1guesttask"), "/tasks");
  assert.equal(pageAfterGuestLogin("/tree/cm1guestpage"), "/tree");
});
