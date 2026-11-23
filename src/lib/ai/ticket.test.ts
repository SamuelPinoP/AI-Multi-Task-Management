import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { parseDescription } from "@/lib/description-sections";
import { ticketDescription, ticketFields, ticketProblem, TICKET_SECTIONS } from "./ticket";
import { ticketOverview } from "./ticket-sections";

const schema = z.strictObject(ticketFields);

const EXPORT_TICKET = {
  summary: "Let people export their open tasks as a CSV file, so they can share them in a spreadsheet.",
  background: ["The person asked for a CSV export on the Tasks page."],
  acceptanceCriteria: ["The Tasks page has an Export button that downloads a CSV file", "A unit test checks the file's columns"],
  outOfScope: ["Importing tasks"],
  openQuestions: ["Should done tasks be in the file too?"],
};

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
      "## Original request",
      "",
      "> Make a ticket: export my tasks as CSV",
      "> from the Tasks page",
    ].join("\n"),
  );
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
  assert.equal(schema.safeParse({ ...EXPORT_TICKET, estimate: "2h" }).success, false);
  assert.equal(schema.safeParse({ ...EXPORT_TICKET, sections: [{ title: "Cost", text: "Low", extra: true }] }).success, false);
  // Spaces around the text go.
  assert.equal(schema.parse({ ...EXPORT_TICKET, summary: "  Short  " }).summary, "Short");
});

test("a ticket needs testable criteria, unless the person asked for other sections, and its own section titles", () => {
  assert.equal(ticketProblem(EXPORT_TICKET), null);
  assert.match(ticketProblem({ summary: "No criteria" }) ?? "", /acceptanceCriteria/);
  assert.match(ticketProblem({ summary: "Empty extra", sections: [{ title: "Cost" }] }) ?? "", /acceptanceCriteria/);
  assert.equal(ticketProblem({ summary: "Bug", sections: [{ title: "Steps to reproduce", items: ["Open the page"] }] }), null);
  assert.match(ticketProblem({ ...EXPORT_TICKET, sections: [{ title: "summary", text: "Again" }] }) ?? "", /own title/);
  assert.match(ticketProblem({ ...EXPORT_TICKET, sections: [{ title: "Cost", text: "A" }, { title: "## Cost", text: "B" }] }) ?? "", /own title/);
});

test("the card sums a ticket up by its summary and counts; a plain description isn't a ticket", () => {
  const description = ticketDescription(EXPORT_TICKET, "Export my tasks");
  assert.deepEqual(ticketOverview(description), { summary: EXPORT_TICKET.summary, facts: "2 acceptance criteria · 1 open question" });
  assert.deepEqual(ticketOverview("## Cost\n\n- Down payment"), { summary: "Down payment", facts: "" });
  assert.equal(ticketOverview("Call the dentist"), null);
  assert.equal(ticketOverview(null), null);
});
