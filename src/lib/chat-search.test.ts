import assert from "node:assert/strict";
import test from "node:test";
import { findMatches, foldForSearch, highlightSegments, normalizeQuery, searchChat, snippetAround } from "./chat-search";

const slices = (text: string, query: string) => findMatches(text, query).map(({ start, end }) => text.slice(start, end));

test("matching ignores case and accents and keeps the original text's positions", () => {
  assert.deepEqual(slices("Launch day! The LAUNCH checklist", "launch"), ["Launch", "LAUNCH"]);
  assert.deepEqual(slices("Meet at the Café, then the cafe", "cafe"), ["Café", "cafe"]);
  assert.deepEqual(slices("Meet at the Café", "CAFÉ"), ["Café"]);
  // A combining accent written as its own character still counts as part of the letter.
  assert.deepEqual(slices("Café au lait", "café"), ["Café"]);
  assert.deepEqual(slices("Überblick und uber", "uber"), ["Über", "uber"]);
});

test("a phrase matches across a line break and repeated spaces in the query", () => {
  assert.deepEqual(slices("go for\nlaunch on Friday", "for launch"), ["for\nlaunch"]);
  assert.deepEqual(slices("go for launch", "  for   launch "), ["for launch"]);
});

test("every occurrence is found once, without overlaps", () => {
  assert.deepEqual(findMatches("aaaa", "aa"), [
    { start: 0, end: 2 },
    { start: 2, end: 4 },
  ]);
  assert.deepEqual(findMatches("nothing here", "launch"), []);
  assert.deepEqual(findMatches("anything", "   "), []);
  assert.deepEqual(findMatches("", "launch"), []);
});

test("positions stay right after characters outside the basic plane", () => {
  const text = "🚀 launch 🚀 Launch";
  assert.deepEqual(slices(text, "launch"), ["launch", "Launch"]);
});

test("folding keeps a map back to the original text", () => {
  assert.deepEqual(foldForSearch("Á b"), { folded: "a b", origin: [0, 1, 2] });
  assert.equal(normalizeQuery("  Hello   WORLD "), "hello world");
});

const messages = [
  { id: "m1", message: "Kickoff notes are in the brief. Target launch is Friday.", attachments: [] },
  { id: "m2", message: "Got it.", attachments: [{ id: "a1", originalName: "launch-plan.pdf" }] },
  { id: "m3", message: "Nothing to see", attachments: [{ id: "a2", originalName: "notes.txt" }] },
  { id: "m4", message: "Then we're go for launch. LAUNCH!", attachments: [] },
  { id: "pending-1", message: "launch again", attachments: [] },
];

test("results come newest first, with matching file names, and skip messages still sending", () => {
  const results = searchChat(messages, "launch");
  assert.deepEqual(
    results.map((result) => result.id),
    ["m4", "m2", "m1"],
  );
  assert.equal(results[0].ranges.length, 2);
  assert.deepEqual(results[1].ranges, []);
  assert.deepEqual(results[1].files, [{ id: "a1", name: "launch-plan.pdf", ranges: [{ start: 0, end: 6 }] }]);
  assert.deepEqual(searchChat(messages, " "), []);
  assert.deepEqual(searchChat(messages, "nowhere"), []);
});

test("highlight segments cover the whole text in order", () => {
  const text = "Then we're go for launch. LAUNCH!";
  const segments = highlightSegments(text, findMatches(text, "launch"));
  assert.deepEqual(segments, [
    { text: "Then we're go for ", match: false },
    { text: "launch", match: true },
    { text: ". ", match: false },
    { text: "LAUNCH", match: true },
    { text: "!", match: false },
  ]);
  assert.equal(segments.map((segment) => segment.text).join(""), text);
  assert.deepEqual(highlightSegments("plain", []), [{ text: "plain", match: false }]);
});

test("a short message is its own snippet, with line breaks as spaces", () => {
  const text = "Go for\nlaunch";
  assert.deepEqual(snippetAround(text, findMatches(text, "launch")), { text: "Go for launch", ranges: [{ start: 7, end: 13 }] });
});

test("a long message's snippet starts near the match, cuts at spaces and marks what was left out", () => {
  const filler = "word ".repeat(40);
  const text = `${filler}the launch checklist is ready ${filler}`;
  const { text: snippet, ranges } = snippetAround(text, findMatches(text, "launch"), { before: 20, length: 60 });
  assert.ok(snippet.startsWith("…"), snippet);
  assert.ok(snippet.endsWith("…"), snippet);
  assert.ok(snippet.length <= 62, snippet);
  assert.equal(ranges.length, 1);
  assert.equal(snippet.slice(ranges[0].start, ranges[0].end), "launch");
  // Whole words only at both ends.
  assert.match(snippet, /^…word /);
  assert.match(snippet, /(word|ready)…$/);
});

test("a match near the start keeps the beginning of the message", () => {
  const text = `launch ${"x".repeat(300)}`;
  const { text: snippet, ranges } = snippetAround(text, findMatches(text, "launch"));
  assert.ok(snippet.startsWith("launch"));
  assert.deepEqual(ranges, [{ start: 0, end: 6 }]);
});
