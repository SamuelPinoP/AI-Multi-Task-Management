import assert from "node:assert/strict";
import test from "node:test";
import {
  checklistProgress,
  cleanSectionTitle,
  descriptionPreview,
  hasSections,
  listItems,
  parseDescription,
  plainText,
  serializeDescription,
  setChecklistItem,
} from "./description-sections";

const TICKET = [
  "## Summary",
  "",
  "Let people export their tasks as a CSV file.",
  "",
  "## Acceptance criteria",
  "",
  "- [ ] The Tasks page has an **Export** button",
  "- [x] A unit test covers the file's columns",
  "",
  "## Original request",
  "",
  "> Add a CSV export",
].join("\n");

test("a description splits into its intro and sections at each ## heading", () => {
  assert.deepEqual(parseDescription(`Buy a car for the family.\n\n${TICKET}`), {
    intro: "Buy a car for the family.",
    sections: [
      { title: "Summary", body: "Let people export their tasks as a CSV file." },
      { title: "Acceptance criteria", body: "- [ ] The Tasks page has an **Export** button\n- [x] A unit test covers the file's columns" },
      { title: "Original request", body: "> Add a CSV export" },
    ],
  });
  // Windows line breaks, closing hashes and up to three spaces before the heading.
  assert.deepEqual(parseDescription("Intro\r\n   ## Cost ##\r\n- Down payment\r\n"), {
    intro: "Intro",
    sections: [{ title: "Cost", body: "- Down payment" }],
  });
});

test("a plain description has no sections, and smaller or empty headings don't start one", () => {
  assert.deepEqual(parseDescription("Call the dentist\nbefore Friday"), { intro: "Call the dentist\nbefore Friday", sections: [] });
  assert.equal(hasSections("Call the dentist"), false);
  assert.equal(hasSections(null), false);
  assert.equal(hasSections(TICKET), true);
  assert.deepEqual(parseDescription("## Cost\n### Monthly\n#Not a heading\n##\n# Big").sections, [{ title: "Cost", body: "### Monthly\n#Not a heading\n##\n# Big" }]);
});

test("a ## line inside a code block or a quote stays in its section", () => {
  const text = "## Steps\n\n```md\n## Not a section\n```\n\n> ## Quoted\n\n## Notes\n\nDone";
  assert.deepEqual(
    parseDescription(text).sections.map((section) => section.title),
    ["Steps", "Notes"],
  );
  // A fence closes only with the same character, at least as long.
  assert.deepEqual(
    parseDescription("## A\n````\n```\n## Still code\n````\n## B").sections.map((section) => section.title),
    ["A", "B"],
  );
});

test("serializing writes each section under its heading and reads back the same", () => {
  const parsed = parseDescription(`Intro line\n\n${TICKET}`);
  assert.equal(serializeDescription(parsed), `Intro line\n\n${TICKET}`);
  assert.deepEqual(parseDescription(serializeDescription(parsed)), parsed);
  assert.equal(serializeDescription({ intro: "", sections: [{ title: " ## Cost # ", body: "\n\n- Down payment\n" }, { title: "Empty", body: "  " }] }), "## Cost\n\n- Down payment\n\n## Empty");
  assert.equal(serializeDescription({ intro: "", sections: [{ title: "   ", body: "Text" }] }), "## Untitled\n\nText");
  assert.equal(serializeDescription({ intro: "  ", sections: [] }), "");
});

test("section titles are one short line", () => {
  assert.equal(cleanSectionTitle("  Monthly\n cost  "), "Monthly cost");
  assert.equal(cleanSectionTitle("## Cost ##"), "Cost");
  assert.equal(cleanSectionTitle("x".repeat(120)).length, 80);
});

test("a checklist item is ticked or unticked by its line", () => {
  const body = "- [ ] One\n  * [x] Two\n3. [ ] Three\n- Plain";
  assert.equal(setChecklistItem(body, 1, true), "- [x] One\n  * [x] Two\n3. [ ] Three\n- Plain");
  assert.equal(setChecklistItem(body, 2, false), "- [ ] One\n  * [ ] Two\n3. [ ] Three\n- Plain");
  assert.equal(setChecklistItem(body, 3, true), "- [ ] One\n  * [x] Two\n3. [x] Three\n- Plain");
  assert.equal(setChecklistItem(body, 4, true), null);
  assert.equal(setChecklistItem(body, 0, true), null);
  assert.equal(setChecklistItem(body, 9, true), null);
});

test("list items and checklist progress count what's outside code", () => {
  const body = "- [ ] One\n- [X] Two\n  - [x] Nested\n\n```\n- [x] Code\n```\nText\n1. Three";
  assert.deepEqual(listItems(body), ["One", "Two", "Three"]);
  assert.deepEqual(checklistProgress(body), { done: 2, total: 3 });
  assert.deepEqual(checklistProgress("No list"), { done: 0, total: 0 });
});

test("Markdown reads as one line of plain text", () => {
  assert.equal(plainText("## Summary\n\nLet **people** export [their tasks](https://example.com) as `CSV`.\n- [ ] _Fast_ and *simple*"), "Summary Let people export their tasks as CSV. Fast and simple");
  assert.equal(plainText("> Quoted\n```\ncode\n```"), "Quoted code");
  assert.equal(plainText("snake_case_name and 2 * 3 * 4"), "snake_case_name and 2 * 3 * 4");
  assert.equal(plainText("\\# not a heading"), "# not a heading");
});

test("a list previews a plain description as it is, and a ticket by its first text", () => {
  assert.equal(descriptionPreview("Call *Bob*\nbefore Friday"), "Call *Bob*\nbefore Friday");
  assert.equal(descriptionPreview(TICKET), "Let people export their tasks as a CSV file.");
  assert.equal(descriptionPreview(`Intro **first**\n\n${TICKET}`), "Intro first");
  assert.equal(descriptionPreview("## Empty\n\n## Cost\n\n- Down payment: 5,000"), "Down payment: 5,000");
  assert.equal(descriptionPreview("## Empty"), "");
  assert.equal(descriptionPreview(null), "");
  // The estimate never shows in a list (#434), so a task with nothing else has no preview.
  const estimate = "## Estimate\n\n**15 min** · AI estimate\nOne call.";
  assert.equal(descriptionPreview(`The sink leaks.\n\n${estimate}`), "The sink leaks.");
  assert.equal(descriptionPreview(estimate), "");
  assert.equal(descriptionPreview(`${estimate}\n\n## Notes\n\nBring the key.`), "Bring the key.");
});
