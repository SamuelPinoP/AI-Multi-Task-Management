import assert from "node:assert/strict";
import test from "node:test";
import { CHAT_FULL_MESSAGE, chatsPastLimit, parseChatTitle, storedSources } from "./chat-history-core";
import { MAX_CHAT_TITLE_CHARS, MAX_CHATS, MAX_MESSAGES } from "./chat-limits";

const day = (n: number) => new Date(Date.UTC(2026, 10, n, 12));

test("each person keeps their latest 20 chats: a 21st pushes out the one whose latest message is oldest (#452)", () => {
  assert.equal(MAX_CHATS, 20);
  const chats = Array.from({ length: MAX_CHATS }, (_, index) => ({ id: `chat-${index}`, updatedAt: day(index + 1) }));
  assert.deepEqual(chatsPastLimit(chats), [], "20 fit");

  // The oldest is chat-0 by its latest message, even though it's listed anywhere.
  const withNew = [{ id: "new", updatedAt: day(25) }, ...[...chats].reverse()];
  assert.deepEqual(chatsPastLimit(withNew), ["chat-0"]);

  // A chat written in recently stays, however long ago it started.
  const continued = chats.map((chat) => (chat.id === "chat-0" ? { ...chat, updatedAt: day(26) } : chat));
  assert.deepEqual(chatsPastLimit([{ id: "new", updatedAt: day(25) }, ...continued]), ["chat-1"]);

  // More than one over (two tabs at once, say): all of them go, and the same instant goes by id.
  const tied = [{ id: "a", updatedAt: day(1) }, { id: "b", updatedAt: day(1) }, { id: "c", updatedAt: day(2) }];
  assert.deepEqual(chatsPastLimit(tied, 1), ["b", "a"]);
  assert.deepEqual(chatsPastLimit(tied, 2), ["a"]);
});

test("a chat's new name has its spaces tidied, and must be there and short enough", () => {
  assert.deepEqual(parseChatTitle({ title: "  Launch   week\nplan " }), { title: "Launch week plan" });
  assert.deepEqual(parseChatTitle({ title: "x".repeat(MAX_CHAT_TITLE_CHARS) }), { title: "x".repeat(MAX_CHAT_TITLE_CHARS) });
  assert.deepEqual(parseChatTitle({ title: "x".repeat(MAX_CHAT_TITLE_CHARS + 1) }), { error: "Keep the name under 100 characters." });
  for (const body of [{ title: "   " }, { title: 42 }, {}, null, "Launch"]) {
    assert.deepEqual(parseChatTitle(body), { error: "Give the chat a name." }, JSON.stringify(body));
  }
});

test("a chat holds 20 questions and their answers", () => {
  assert.equal(MAX_MESSAGES, 40);
  assert.equal(CHAT_FULL_MESSAGE, "Start a new chat: one can hold up to 40 messages.");
});

test("stored links are kept only when well formed and inside AI Multi", () => {
  const task = { kind: "task", id: "t1", title: "Pay rent", href: "/tasks?task=t1" };
  const project = { kind: "project", id: "p1", title: "Whitewall", href: "/projects/p1" };
  assert.deepEqual(storedSources([task, project]), [task, project]);
  assert.deepEqual(
    storedSources([
      task,
      { ...task, href: "https://evil.example/tasks" },
      { ...task, href: "//evil.example" },
      { ...task, href: "/\\evil.example" },
      { ...task, kind: "script" },
      { ...task, title: 7 },
      null,
      "task",
    ]),
    [task],
  );
  assert.deepEqual(storedSources(null), []);
  assert.deepEqual(storedSources({ kind: "task" }), []);
});
