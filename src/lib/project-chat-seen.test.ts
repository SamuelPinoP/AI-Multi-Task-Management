import assert from "node:assert/strict";
import test from "node:test";
import { isChatUnread, parseChatSeen, pruneChatSeen } from "./project-chat-seen";

test("a chat is new when someone posted after it was last opened", () => {
  assert.equal(isChatUnread("2026-10-20T12:00:00.000Z", "2026-10-20T11:00:00.000Z"), true);
  assert.equal(isChatUnread("2026-10-20T12:00:00.000Z", "2026-10-20T13:00:00.000Z"), false);
});

test("a recent message in a chat never opened here counts as new", () => {
  assert.equal(isChatUnread("2026-10-20T12:00:00.000Z", undefined), true);
  assert.equal(isChatUnread("2026-10-20T12:00:00.000Z", "not a date"), true);
});

test("a chat without recent messages is never new", () => {
  assert.equal(isChatUnread(null, undefined), false);
  assert.equal(isChatUnread("garbage", undefined), false);
});

test("stored seen times ignore anything that isn't a map of strings", () => {
  assert.deepEqual(parseChatSeen(null), {});
  assert.deepEqual(parseChatSeen("{"), {});
  assert.deepEqual(parseChatSeen("[1,2]"), {});
  assert.deepEqual(parseChatSeen('{"a":"2026-10-20T12:00:00.000Z","b":5}'), { a: "2026-10-20T12:00:00.000Z" });
});

test("pruning keeps the most recently seen chats", () => {
  const seen = {
    old: "2026-10-01T00:00:00.000Z",
    newest: "2026-10-20T00:00:00.000Z",
    middle: "2026-10-10T00:00:00.000Z",
  };
  assert.deepEqual(Object.keys(pruneChatSeen(seen, 2)).sort(), ["middle", "newest"]);
});
