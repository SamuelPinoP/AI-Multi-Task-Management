import assert from "node:assert/strict";
import test from "node:test";
import {
  chatPreview,
  filterChatSummaries,
  formatChatTime,
  formatUnreadCount,
  sortChatSummaries,
  teammateCount,
  type ChatSummary,
} from "./chats";

function chat(name: string, unread: number, at: string | null, text = "Hello"): ChatSummary {
  return {
    projectId: name.toLowerCase().replace(/\s+/g, "-"),
    name,
    color: null,
    accessLevel: "EDITOR",
    memberCount: 2,
    unread,
    teammates: 1,
    lastMessage: at ? { author: "Ana", text, attachmentCount: 0, at, timeLabel: "9:40 AM" } : null,
  };
}

/** Intl puts a narrow no-break space before AM/PM; tests compare plain spaces. */
const plain = (value: string) => value.replace(/\s/g, " ");

test("unread chats come first, then the newest message, then chats without messages by name", () => {
  const sorted = sortChatSummaries([
    chat("Zeta quiet", 0, null),
    chat("Old read", 0, "2026-10-18T10:00:00.000Z"),
    chat("Alpha quiet", 0, null),
    chat("Older unread", 2, "2026-10-19T08:00:00.000Z"),
    chat("New read", 0, "2026-10-21T09:00:00.000Z"),
    chat("Newer unread", 1, "2026-10-21T08:15:00.000Z"),
  ]);
  assert.deepEqual(sorted.map((item) => item.name), [
    "Newer unread",
    "Older unread",
    "New read",
    "Old read",
    "Alpha quiet",
    "Zeta quiet",
  ]);
});

test("the Unread filter and the search narrow the list", () => {
  const chats = [
    chat("Website relaunch", 3, "2026-10-21T09:40:00.000Z", "Can we lock the copy by Thursday?"),
    chat("Capstone demo", 0, "2026-10-21T08:15:00.000Z", "Updated slides are in the folder"),
    chat("Marketing plan", 0, null),
  ];
  assert.deepEqual(filterChatSummaries(chats, "unread", "").map((item) => item.name), ["Website relaunch"]);
  assert.deepEqual(filterChatSummaries(chats, "all", "  SLIDES ").map((item) => item.name), ["Capstone demo"]);
  assert.deepEqual(filterChatSummaries(chats, "all", "plan").map((item) => item.name), ["Marketing plan"]);
  assert.deepEqual(filterChatSummaries(chats, "unread", "slides"), []);
  assert.equal(filterChatSummaries(chats, "all", "").length, 3);
});

test("the Unread filter keeps chats opened since the page loaded", () => {
  const chats = [chat("Website relaunch", 0, "2026-10-21T09:40:00.000Z"), chat("Mobile app", 0, "2026-10-20T12:00:00.000Z")];
  assert.deepEqual(filterChatSummaries(chats, "unread", "", new Set(["website-relaunch"])).map((item) => item.name), ["Website relaunch"]);
});

test("previews name the author, or say what a file-only message sent", () => {
  assert.equal(chatPreview(chat("A", 0, "2026-10-21T09:40:00.000Z", "Ready for review")), "Ana: Ready for review");
  const files = chat("B", 0, "2026-10-21T09:40:00.000Z", "");
  files.lastMessage!.attachmentCount = 2;
  assert.equal(chatPreview(files), "Ana sent 2 files");
  files.lastMessage!.attachmentCount = 1;
  files.lastMessage!.author = "You";
  assert.equal(chatPreview(files), "You sent 1 file");
  assert.equal(chatPreview(chat("C", 0, null)), "No messages yet");
});

test("badges cap at 99+", () => {
  assert.equal(formatUnreadCount(1), "1");
  assert.equal(formatUnreadCount(99), "99");
  assert.equal(formatUnreadCount(100), "99+");
});

test("message times: today's time, Yesterday, a weekday, then the date", () => {
  const now = new Date("2026-10-21T15:00:00.000Z"); // Wednesday
  const zone = "America/New_York";
  assert.equal(plain(formatChatTime(new Date("2026-10-21T13:40:00.000Z"), now, zone)), "9:40 AM");
  assert.equal(formatChatTime(new Date("2026-10-20T22:00:00.000Z"), now, zone), "Yesterday");
  assert.equal(formatChatTime(new Date("2026-10-19T16:00:00.000Z"), now, zone), "Mon");
  assert.equal(formatChatTime(new Date("2026-10-14T16:00:00.000Z"), now, zone), "Oct 14");
  assert.equal(formatChatTime(new Date("2025-12-30T16:00:00.000Z"), now, zone), "Dec 30, 2025");
});

test("message times follow the user's time zone across midnight", () => {
  // 02:30 UTC on October 21 is still October 20 in New York, but already the 21st in UTC.
  const now = new Date("2026-10-21T12:00:00.000Z");
  const late = new Date("2026-10-21T02:30:00.000Z");
  assert.equal(formatChatTime(late, now, "America/New_York"), "Yesterday");
  assert.equal(plain(formatChatTime(late, now, "UTC")), "2:30 AM");
});

test("teammates are the other people with an account, owner included", () => {
  const project = { userId: "owner", members: [{ userId: "owner" }, { userId: "ana" }, { userId: null }, { userId: "me" }] };
  // A member without an account can't chat, and the user doesn't count.
  assert.equal(teammateCount(project, "me"), 2);
  assert.equal(teammateCount(project, "owner"), 2);
  assert.equal(teammateCount({ userId: "me", members: [{ userId: null }] }, "me"), 0);
});
