import assert from "node:assert/strict";
import test from "node:test";
import { goTargets, resolveShortcut, sendsChatMessage } from "./shortcuts";

/** A key press in a chat message box: Enter, unless overridden. */
function press(overrides: Partial<Parameters<typeof sendsChatMessage>[0]> = {}) {
  return { key: "Enter", shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, isComposing: false, keyCode: 13, ...overrides };
}

test("single keys", () => {
  assert.deepEqual(resolveShortcut("n", false), { type: "new-task" });
  assert.deepEqual(resolveShortcut("N", false), { type: "new-task" });
  assert.deepEqual(resolveShortcut("/", false), { type: "search" });
  assert.deepEqual(resolveShortcut("?", false), { type: "help" });
  assert.deepEqual(resolveShortcut("g", false), { type: "start-go" });
  assert.equal(resolveShortcut("x", false), null);
  assert.equal(resolveShortcut("Enter", false), null);
});

test("g then a letter goes to a page", () => {
  assert.deepEqual(resolveShortcut("t", true), { type: "go", href: "/tasks" });
  assert.deepEqual(resolveShortcut("H", true), { type: "go", href: "/" });
  assert.deepEqual(resolveShortcut("n", true), { type: "go", href: "/notes" });
  assert.deepEqual(resolveShortcut("m", true), { type: "go", href: "/chats" });
  assert.equal(resolveShortcut("z", true), null);
});

test("g then e or c opens the Calendar's Agenda or Month tab", () => {
  assert.deepEqual(resolveShortcut("e", true), { type: "go", href: "/events" });
  assert.deepEqual(resolveShortcut("c", true), { type: "go", href: "/events/calendar" });
  assert.equal(goTargets.e.label, "Calendar: Agenda");
  assert.equal(goTargets.c.label, "Calendar: Month");
});

test("every go target is a different page", () => {
  const hrefs = Object.values(goTargets).map((target) => target.href);
  assert.equal(new Set(hrefs).size, hrefs.length);
});

test("in a chat, Enter sends and Shift+Enter starts a new line", () => {
  assert.equal(sendsChatMessage(press(), false), true);
  assert.equal(sendsChatMessage(press({ shiftKey: true }), false), false);
  assert.equal(sendsChatMessage(press({ altKey: true }), false), false);
  assert.equal(sendsChatMessage(press({ ctrlKey: true }), false), true);
  assert.equal(sendsChatMessage(press({ metaKey: true }), false), true);
  assert.equal(sendsChatMessage(press({ ctrlKey: true, shiftKey: true }), false), false);
  assert.equal(sendsChatMessage(press({ key: "a", keyCode: 65 }), false), false);
});

test("an Enter that picks an input-method word doesn't send", () => {
  assert.equal(sendsChatMessage(press({ isComposing: true }), false), false);
  // Safari ends the composition first, so only keyCode 229 tells.
  assert.equal(sendsChatMessage(press({ keyCode: 229 }), false), false);
});

test("on a touch screen, Enter starts a new line and Ctrl or ⌘+Enter sends", () => {
  assert.equal(sendsChatMessage(press(), true), false);
  assert.equal(sendsChatMessage(press({ shiftKey: true }), true), false);
  assert.equal(sendsChatMessage(press({ ctrlKey: true }), true), true);
  assert.equal(sendsChatMessage(press({ metaKey: true }), true), true);
});
