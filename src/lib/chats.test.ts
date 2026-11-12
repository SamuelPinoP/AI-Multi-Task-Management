import assert from "node:assert/strict";
import test from "node:test";
import {
  chatListView,
  chatPreview,
  directChatKey,
  directChatPreview,
  formatChatTime,
  formatUnreadCount,
  projectChatKey,
  searchTarget,
  sortChatSummaries,
  sortDirectChats,
  teammateCount,
  type ChatFilter,
  type ChatSummary,
  type DirectChatSummary,
} from "./chats";

function chat(name: string, unread: number, at: string | null, text = "Hello"): ChatSummary {
  return {
    projectId: name.toLowerCase().replace(/\s+/g, "-"),
    name,
    color: null,
    photoUpdatedAt: null,
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

function direct(name: string, unread: number, at: string, text = "Hi", author = name.split(" ")[0]): DirectChatSummary {
  return {
    personId: name.toLowerCase().replace(/\s+/g, "-"),
    name,
    unread,
    projects: ["Capstone"],
    lastMessage: { author, text, attachmentCount: 0, at, timeLabel: "9:40 AM" },
  };
}

const projects = [
  chat("Website relaunch", 3, "2026-10-21T09:40:00.000Z", "Can we lock the copy by Thursday?"),
  chat("Capstone demo", 0, "2026-10-21T08:15:00.000Z", "Updated slides are in the folder"),
];
const directs = [direct("Ana Torres", 2, "2026-10-21T09:00:00.000Z"), direct("Leo Kim", 0, "2026-10-20T12:00:00.000Z")];
const teammates = [
  { id: "ana-torres", name: "Ana Torres", projects: ["Capstone"] },
  { id: "leo-kim", name: "Leo Kim", projects: ["Capstone"] },
  { id: "maya", name: "Maya Chen", projects: ["Website relaunch"] },
];
const view = (filter: ChatFilter, query = "", keepUnread?: Set<string>) =>
  chatListView({ projects, directs, teammates, filter, query, keepUnread });

test("without a search the chips pick the sections: projects first, then direct messages", () => {
  const all = view("all");
  assert.equal(all.kind, "sections");
  if (all.kind !== "sections") return;
  assert.deepEqual(all.projects?.map((item) => item.name), ["Website relaunch", "Capstone demo"]);
  assert.deepEqual(all.people?.map((item) => item.name), ["Ana Torres", "Leo Kim"]);

  const unread = view("unread");
  if (unread.kind !== "sections") throw new Error(unread.kind);
  assert.deepEqual(unread.projects?.map((item) => item.name), ["Website relaunch"]);
  assert.deepEqual(unread.people?.map((item) => item.name), ["Ana Torres"]);

  const people = view("people");
  if (people.kind !== "sections") throw new Error(people.kind);
  assert.equal(people.projects, null);
  assert.equal(people.people?.length, 2);

  const onlyProjects = view("projects");
  if (onlyProjects.kind !== "sections") throw new Error(onlyProjects.kind);
  assert.equal(onlyProjects.people, null);
  assert.equal(onlyProjects.projects?.length, 2);
});

test("the search finds people: your chats first, then anyone else in your projects", () => {
  const found = view("all", "  a ");
  assert.equal(found.kind, "people");
  if (found.kind !== "people") return;
  assert.deepEqual(found.people.map((person) => [person.name, Boolean(person.chat)]), [["Ana Torres", true]]);

  const maya = view("people", "maya");
  if (maya.kind !== "people") throw new Error(maya.kind);
  assert.deepEqual(maya.people, [{ personId: "maya", name: "Maya Chen", projects: ["Website relaunch"], chat: null }]);

  // A project's name or messages never match a people search.
  const none = view("all", "website");
  if (none.kind !== "people") throw new Error(none.kind);
  assert.deepEqual(none.people, []);

  // Under Unread, a search stays within unread chats.
  const unread = view("unread", "leo");
  if (unread.kind !== "people") throw new Error(unread.kind);
  assert.deepEqual(unread.people, []);
});

test("under Projects the search finds projects by name", () => {
  assert.equal(searchTarget("projects"), "projects");
  assert.equal(searchTarget("unread"), "people");
  const found = view("projects", "capstone");
  if (found.kind !== "projects") throw new Error(found.kind);
  assert.deepEqual(found.projects.map((item) => item.name), ["Capstone demo"]);
});

test("the Unread chip keeps chats opened since the page loaded", () => {
  const read = { ...directs[1], unread: 0 };
  const kept = chatListView({
    projects: [{ ...projects[1] }],
    directs: [read],
    teammates,
    filter: "unread",
    query: "",
    keepUnread: new Set([projectChatKey(projects[1].projectId), directChatKey(read.personId)]),
  });
  if (kept.kind !== "sections") throw new Error(kept.kind);
  assert.deepEqual(kept.projects?.map((item) => item.name), ["Capstone demo"]);
  assert.deepEqual(kept.people?.map((item) => item.name), ["Leo Kim"]);
});

test("direct chats: unread first, then the newest; previews show yours after You:", () => {
  const sorted = sortDirectChats([direct("Old", 0, "2026-10-18T10:00:00.000Z"), direct("New", 0, "2026-10-21T10:00:00.000Z"), direct("Unread", 1, "2026-10-17T10:00:00.000Z")]);
  assert.deepEqual(sorted.map((item) => item.name), ["Unread", "New", "Old"]);
  assert.equal(directChatPreview(direct("Ana", 0, "2026-10-21T10:00:00.000Z", "See you")), "See you");
  assert.equal(directChatPreview(direct("Ana", 0, "2026-10-21T10:00:00.000Z", "Sent it", "You")), "You: Sent it");
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
