import assert from "node:assert/strict";
import test from "node:test";
import { extractNoteLinks, linksTo, noteLinkKey, taskFromSelection } from "./note-links";

test("finds [[links]] once each, keeping the first spelling", () => {
  const content = "See [[Budget 2027]] and [[ budget   2027 ]].\nAlso [[Venue options]], not [[]] or [[a\nb]] or [single].";
  assert.deepEqual(extractNoteLinks(content), ["Budget 2027", "Venue options"]);
  assert.deepEqual(extractNoteLinks(null), []);
});

test("links match titles without regard to case or spacing", () => {
  assert.equal(noteLinkKey("  Venue   Options "), "venue options");
  assert.equal(linksTo("Plan: [[venue options]]", "Venue Options"), true);
  assert.equal(linksTo("Plan: [[Venue]]", "Venue options"), false);
  assert.equal(linksTo("[[Anything]]", "  "), false);
});

test("selected text becomes a task title and description", () => {
  assert.deepEqual(taskFromSelection("Call the venue"), { title: "Call the venue", description: null });
  assert.deepEqual(taskFromSelection("- [ ] Book the room\n  for 20 people\n\n  with a projector"), {
    title: "Book the room",
    description: "for 20 people\nwith a projector",
  });
  assert.deepEqual(taskFromSelection("2. Send the [[Budget 2027]] draft"), { title: "Send the Budget 2027 draft", description: null });
  assert.equal(taskFromSelection("   \n  ").title, "");
  assert.equal(taskFromSelection("x".repeat(300)).title.length, 200);
});
