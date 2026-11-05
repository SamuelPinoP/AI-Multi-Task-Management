import assert from "node:assert/strict";
import test from "node:test";
import {
  confirmationLinkUrl,
  formatCountdown,
  isUsableEmail,
  RESEND_COOLDOWN_SECONDS,
  resendTooSoonMessage,
  secondsUntilResend,
  tooManyConfirmationEmailsMessage,
  waitPhrase,
} from "./email-confirmation-core";

const sentAt = new Date("2026-11-05T12:00:00.000Z");
const after = (ms: number) => new Date(sentAt.getTime() + ms);

test("another email waits a minute after the last one", () => {
  assert.equal(RESEND_COOLDOWN_SECONDS, 60);
  assert.equal(secondsUntilResend(sentAt, sentAt), 60);
  assert.equal(secondsUntilResend(sentAt, after(18_000)), 42);
  // Part of a second still counts as a second, so the button never opens early.
  assert.equal(secondsUntilResend(sentAt, after(59_001)), 1);
  assert.equal(secondsUntilResend(sentAt, after(60_000)), 0);
  assert.equal(secondsUntilResend(sentAt, after(3_600_000)), 0);
});

test("no wait when nothing was sent, or the clock says it was sent later", () => {
  assert.equal(secondsUntilResend(null, sentAt), 0);
  assert.equal(secondsUntilResend(undefined, sentAt), 0);
  // A server clock behind the database's never asks for more than the full minute.
  assert.equal(secondsUntilResend(after(5_000), sentAt), 60);
});

test("countdowns read like a clock", () => {
  assert.equal(formatCountdown(60), "1:00");
  assert.equal(formatCountdown(42), "0:42");
  assert.equal(formatCountdown(9), "0:09");
  assert.equal(formatCountdown(0), "0:00");
  assert.equal(formatCountdown(-3), "0:00");
  assert.equal(formatCountdown(41.2), "0:42");
  assert.equal(formatCountdown(15 * 60 + 5), "15:05");
  assert.equal(formatCountdown(3 * 3600 + 5 * 60), "3:05:00");
});

test("waits are said in the largest unit that reads naturally, rounded up", () => {
  assert.equal(waitPhrase(1), "1 second");
  assert.equal(waitPhrase(0), "1 second");
  assert.equal(waitPhrase(42), "42 seconds");
  assert.equal(waitPhrase(60), "1 minute");
  assert.equal(waitPhrase(61), "2 minutes");
  assert.equal(waitPhrase(89 * 60), "89 minutes");
  assert.equal(waitPhrase(90 * 60), "2 hours");
  assert.equal(waitPhrase(22 * 3600 + 1), "23 hours");
});

test("refusals say when to try again", () => {
  assert.equal(resendTooSoonMessage(42), "Please wait 42 seconds before sending another email.");
  assert.equal(
    tooManyConfirmationEmailsMessage(15 * 60),
    "That's the most confirmation emails we can send for now. Try again in 15 minutes.",
  );
  assert.equal(
    tooManyConfirmationEmailsMessage(5 * 3600),
    "That's the most confirmation emails we can send for now. Try again in 5 hours.",
  );
});

test("the emailed link confirms, then carries on to where the account was going", () => {
  assert.equal(confirmationLinkUrl("https://app.example", "abc"), "https://app.example/api/auth/verify-email?token=abc");
  assert.equal(confirmationLinkUrl("https://app.example/", "abc", "/"), "https://app.example/api/auth/verify-email?token=abc");
  assert.equal(
    confirmationLinkUrl("http://localhost:3000//", "a-b_c", "/projects"),
    "http://localhost:3000/api/auth/verify-email?token=a-b_c&next=%2Fprojects",
  );
  const url = new URL(confirmationLinkUrl("https://app.example", "t0k3n", "/tasks?view=board"));
  assert.equal(url.searchParams.get("token"), "t0k3n");
  assert.equal(url.searchParams.get("next"), "/tasks?view=board");
});

test("an account's email needs something on both sides of an @", () => {
  for (const email of ["sam@example.com", "a@b", "o'neil+test@example.co.uk"]) assert.equal(isUsableEmail(email), true, email);
  for (const email of ["", "sam", "@example.com", "sam@", "sam @example.com", `${"a".repeat(250)}@b.co`]) {
    assert.equal(isUsableEmail(email), false, email);
  }
});
