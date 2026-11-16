import assert from "node:assert/strict";
import test from "node:test";
import { EMPTY_FEEDBACK_MESSAGE, FEEDBACK_MAX_LENGTH, LONG_FEEDBACK_MESSAGE, parseFeedback } from "./feedback-core";

test("takes a message, trimmed, and whether a reply is welcome", () => {
  assert.deepEqual(parseFeedback({ message: "  The calendar is great.\n", mayReply: true }), { message: "The calendar is great.", mayReply: true });
  assert.deepEqual(parseFeedback({ message: "Tasks feel slow." }), { message: "Tasks feel slow.", mayReply: false });
});

test("only a real true allows a reply", () => {
  for (const mayReply of ["true", 1, "yes", null, undefined, false]) {
    assert.deepEqual(parseFeedback({ message: "Hi", mayReply }), { message: "Hi", mayReply: false });
  }
});

test("refuses an empty message", () => {
  for (const body of [null, undefined, "text", 42, {}, { message: "" }, { message: "   \n " }, { message: 7 }]) {
    assert.deepEqual(parseFeedback(body), { error: EMPTY_FEEDBACK_MESSAGE });
  }
});

test("refuses a message over the limit, counting after trimming", () => {
  assert.deepEqual(parseFeedback({ message: "x".repeat(FEEDBACK_MAX_LENGTH) }), { message: "x".repeat(FEEDBACK_MAX_LENGTH), mayReply: false });
  assert.deepEqual(parseFeedback({ message: `  ${"x".repeat(FEEDBACK_MAX_LENGTH)}  ` }), { message: "x".repeat(FEEDBACK_MAX_LENGTH), mayReply: false });
  assert.deepEqual(parseFeedback({ message: "x".repeat(FEEDBACK_MAX_LENGTH + 1) }), { error: LONG_FEEDBACK_MESSAGE });
  assert.equal(LONG_FEEDBACK_MESSAGE, "Keep it under 2,000 characters.");
});
