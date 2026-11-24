import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { parseDescription } from "@/lib/description-sections";
import { descriptionEstimate } from "@/lib/estimates";
import { ticketDescription, ticketFields, ticketProblem, TICKET_SECTIONS } from "./ticket";
import { draftOverview } from "./ticket-sections";

const schema = z.strictObject(ticketFields);

const EXPORT_TICKET = {
  summary: "Let people export their open tasks as a CSV file, so they can share them in a spreadsheet.",
  background: ["The person asked for a CSV export on the Tasks page."],
  acceptanceCriteria: ["The Tasks page has an Export button that downloads a CSV file", "A unit test checks the file's columns"],
  outOfScope: ["Importing tasks"],
  openQuestions: ["Should done tasks be in the file too?"],
  estimate: { size: "1 day" as const, reason: "A button, the file's columns, and a unit and an e2e test." },
};

/** Subtasks that split big work, each with its own estimate (#434). */
const AUDIT_SIGN_IN = { title: "Audit sign-in", size: "2 days" as const, reason: "Every way in." };
const AUDIT_UPLOADS = { title: "Audit uploads", size: "1 day" as const, reason: "Every file type." };

test("a ticket's description has its sections in order, criteria as a checklist, and the person's words last", () => {
  const description = ticketDescription(EXPORT_TICKET, "Make a ticket: export my tasks as CSV\nfrom the Tasks page");
  assert.equal(
    description,
    [
      "## Summary",
      "",
      "Let people export their open tasks as a CSV file, so they can share them in a spreadsheet.",
      "",
      "## Background",
      "",
      "- The person asked for a CSV export on the Tasks page.",
      "",
      "## Acceptance criteria",
      "",
      "- [ ] The Tasks page has an Export button that downloads a CSV file",
      "- [ ] A unit test checks the file's columns",
      "",
      "## Out of scope",
      "",
      "- Importing tasks",
      "",
      "## Open questions",
      "",
      "- Should done tasks be in the file too?",
      "",
      "## Estimate",
      "",
      "**1 day** · AI estimate",
      "A button, the file's columns, and a unit and an e2e test.",
      "",
      "## Original request",
      "",
      "> Make a ticket: export my tasks as CSV",
      "> from the Tasks page",
    ].join("\n"),
  );
});

test("the estimate reads back as the AI's; over 2 days it says the work is worth splitting", () => {
  const short = ticketDescription(EXPORT_TICKET, "Export my tasks");
  assert.deepEqual(descriptionEstimate(short), { minutes: 480, ai: true });

  const long = ticketDescription({ ...EXPORT_TICKET, estimate: { size: "1 week", reason: "- Four areas\n to check" }, split: [AUDIT_SIGN_IN, AUDIT_UPLOADS] }, "Audit the app");
  const sections = parseDescription(long).sections;
  assert.deepEqual(
    sections.map((section) => section.title),
    ["Summary", "Background", "Acceptance criteria", "Out of scope", "Open questions", "Estimate", "Original request"],
  );
  // The reason stays one line of text, and the subtasks are left to the proposal.
  assert.equal(sections[5].body, "**1 week** · AI estimate\nFour areas to check\n\nMore than 2 days of work: worth splitting into subtasks.");
  assert.doesNotMatch(long, /Audit sign-in/);
  assert.deepEqual(descriptionEstimate(long), { minutes: 2400, ai: true });

  // A ticket that's a subtask can't be split, so its estimate doesn't say to (#434).
  const subtask = ticketDescription({ ...EXPORT_TICKET, estimate: { size: "1 week", reason: "Four areas to check" } }, "Audit the app", { subtask: true });
  assert.equal(parseDescription(subtask).sections[5].body, "**1 week** · AI estimate\nFour areas to check");
});

test("work over 2 days comes with 2 to 5 subtasks that split it, and only that work does", () => {
  const reason = "An app, a code at sign-in and recovery codes.";
  assert.match(ticketProblem({ ...EXPORT_TICKET, estimate: { size: "3 days", reason } }) ?? "", /over 2 days: give split/);
  assert.match(ticketProblem({ ...EXPORT_TICKET, estimate: { size: "1 week", reason }, split: [] }) ?? "", /over 2 days: give split/);
  assert.equal(ticketProblem({ ...EXPORT_TICKET, estimate: { size: "3 days", reason }, split: [AUDIT_SIGN_IN, AUDIT_UPLOADS] }), null);
  // A subtask can't be split, so it needs no split (#434).
  assert.equal(ticketProblem({ ...EXPORT_TICKET, estimate: { size: "3 days", reason }, parent: "Harden the app" }), null);
  // 2 days isn't over 2 days.
  assert.match(ticketProblem({ ...EXPORT_TICKET, estimate: { size: "2 days", reason }, split: [AUDIT_SIGN_IN, AUDIT_UPLOADS] }) ?? "", /only for an estimate over 2 days/);
  assert.match(ticketProblem({ ...EXPORT_TICKET, split: [AUDIT_SIGN_IN, AUDIT_UPLOADS] }) ?? "", /create_task with this ticket's ref/);
});

test("empty sections are left out, and the person's extra sections go after Background", () => {
  const description = ticketDescription(
    {
      summary: "Buy a family car.",
      sections: [
        { title: "Cost", items: ["Down payment", "Monthly payment"] },
        { title: "Dealers", text: "Two near home." },
        { title: "Empty" },
      ],
      acceptanceCriteria: ["The car is bought"],
    },
    "",
  );
  assert.deepEqual(
    parseDescription(description).sections.map((section) => section.title),
    ["Summary", "Cost", "Dealers", "Acceptance criteria"],
  );
  assert.match(description, /## Cost\n\n- Down payment\n- Monthly payment\n\n## Dealers\n\nTwo near home\./);
});

test("the model's text can't add sections, quotes or code blocks, and loses the markers it typed", () => {
  const description = ticketDescription(
    {
      summary: "First line\n## Injected section\n\n> quoted\n\n```\ncode",
      background: ["- already a list item", "1. numbered", "multi\nline"],
      acceptanceCriteria: ["- [ ] already a checkbox", "# heading-like"],
    },
    "## Not a heading\n```",
  );
  const parsed = parseDescription(description);
  assert.deepEqual(
    parsed.sections.map((section) => section.title),
    ["Summary", "Background", "Acceptance criteria", "Original request"],
  );
  // Joined into one line, the heading is just text; a quote or a fence at a paragraph's start is escaped.
  assert.equal(parsed.sections[0].body, "First line ## Injected section\n\n\\> quoted\n\n\\``` code");
  assert.equal(parseDescription(ticketDescription({ summary: "## Alone", acceptanceCriteria: ["Done"] })).sections[0].body, "\\## Alone");
  assert.equal(parsed.sections[1].body, "- already a list item\n- numbered\n- multi line");
  assert.equal(parsed.sections[2].body, "- [ ] already a checkbox\n- [ ] \\# heading-like");
  assert.equal(parsed.sections[3].body, "> ## Not a heading\n> ```");
});

test("without the person's words there's no Original request", () => {
  const description = ticketDescription({ summary: "Short", acceptanceCriteria: ["Done"] });
  assert.equal(parseDescription(description).sections.at(-1)?.title, TICKET_SECTIONS.acceptanceCriteria);
});

test("the schema checks each part's type and length", () => {
  assert.equal(schema.safeParse(EXPORT_TICKET).success, true);
  assert.equal(schema.safeParse({ ...EXPORT_TICKET, summary: "" }).success, false);
  assert.equal(schema.safeParse({ ...EXPORT_TICKET, acceptanceCriteria: [] }).success, false);
  assert.equal(schema.safeParse({ ...EXPORT_TICKET, acceptanceCriteria: Array.from({ length: 11 }, (_, index) => `Criterion ${index}`) }).success, false);
  assert.equal(schema.safeParse({ ...EXPORT_TICKET, background: ["x".repeat(301)] }).success, false);
  assert.equal(schema.safeParse({ ...EXPORT_TICKET, sections: [{ title: "Cost", text: "Low", extra: true }] }).success, false);
  // Spaces around the text go.
  assert.equal(schema.parse({ ...EXPORT_TICKET, summary: "  Short  " }).summary, "Short");
});

test("every ticket has an estimate: one of the fixed steps, with a one-line reason", () => {
  const { estimate, ...withoutEstimate } = EXPORT_TICKET;
  assert.equal(schema.safeParse(withoutEstimate).success, false);
  assert.equal(schema.safeParse({ ...EXPORT_TICKET, estimate: "2h" }).success, false);
  assert.equal(schema.safeParse({ ...EXPORT_TICKET, estimate: { ...estimate, size: "5 h" } }).success, false);
  assert.equal(schema.safeParse({ ...EXPORT_TICKET, estimate: { ...estimate, reason: " " } }).success, false);
  assert.equal(schema.safeParse({ ...EXPORT_TICKET, estimate: { ...estimate, reason: "x".repeat(201) } }).success, false);
  assert.equal(schema.safeParse({ ...EXPORT_TICKET, estimate: { ...estimate, minutes: 480 } }).success, false);
  // The split: 2 to 5 subtasks, each with a title as long as a task title the model writes, and its
  // own estimate of 2 days or less, with a reason (#434).
  const big = { ...EXPORT_TICKET, estimate: { ...estimate, size: "1 week" } };
  const part = (title: string) => ({ title, size: "1 day", reason: "One part." });
  assert.equal(schema.safeParse({ ...big, split: [part("One"), part("Two")] }).success, true);
  assert.equal(schema.safeParse({ ...big, split: [part("One")] }).success, false);
  assert.equal(schema.safeParse({ ...big, split: ["1", "2", "3", "4", "5", "6"].map(part) }).success, false);
  assert.equal(schema.safeParse({ ...big, split: [part("One"), part("x".repeat(201))] }).success, false);
  assert.equal(schema.safeParse({ ...big, split: ["One", "Two"] }).success, false, "titles alone have no estimates");
  assert.equal(schema.safeParse({ ...big, split: [part("One"), { ...part("Two"), size: "3 days" }] }).success, false);
  assert.equal(schema.safeParse({ ...big, split: [part("One"), { ...part("Two"), reason: "" }] }).success, false);
});

test("a ticket needs testable criteria, unless the person asked for other sections, and its own section titles", () => {
  assert.equal(ticketProblem(EXPORT_TICKET), null);
  assert.match(ticketProblem({ summary: "No criteria" }) ?? "", /acceptanceCriteria/);
  assert.match(ticketProblem({ summary: "Empty extra", sections: [{ title: "Cost" }] }) ?? "", /acceptanceCriteria/);
  assert.equal(ticketProblem({ summary: "Bug", sections: [{ title: "Steps to reproduce", items: ["Open the page"] }] }), null);
  assert.match(ticketProblem({ ...EXPORT_TICKET, sections: [{ title: "summary", text: "Again" }] }) ?? "", /own title/);
  assert.match(ticketProblem({ ...EXPORT_TICKET, sections: [{ title: "Estimate", text: "Soon" }] }) ?? "", /own title/);
  assert.match(ticketProblem({ ...EXPORT_TICKET, sections: [{ title: "Cost", text: "A" }, { title: "## Cost", text: "B" }] }) ?? "", /own title/);
});

test("the card sums a ticket up by its summary and counts, and a task with sections by its details; a plain description has no draft", () => {
  const description = ticketDescription(EXPORT_TICKET, "Export my tasks");
  assert.deepEqual(draftOverview(description), { ticket: true, summary: EXPORT_TICKET.summary, facts: "2 acceptance criteria · 1 open question" });
  assert.deepEqual(draftOverview("## Cost\n\n- Down payment"), { ticket: false, summary: "Down payment", facts: "" });
  // A task with the AI's estimate (#434) shows its details, never the estimate, and may have none.
  const estimate = "## Estimate\n\n**15 min** · AI estimate\nOne call.";
  assert.deepEqual(draftOverview(`The sink leaks.\n\n${estimate}`), { ticket: false, summary: "The sink leaks.", facts: "" });
  assert.deepEqual(draftOverview(estimate), { ticket: false, summary: "", facts: "" });
  assert.equal(draftOverview("Call the dentist"), null);
  assert.equal(draftOverview(null), null);
});
