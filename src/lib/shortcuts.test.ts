import assert from "node:assert/strict";
import test from "node:test";
import { goTargets, resolveShortcut } from "./shortcuts";

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

test("every go target is a different page", () => {
  const hrefs = Object.values(goTargets).map((target) => target.href);
  assert.equal(new Set(hrefs).size, hrefs.length);
});
