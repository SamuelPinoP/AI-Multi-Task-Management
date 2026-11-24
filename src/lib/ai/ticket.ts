// Tickets the AI assistant writes (#433): a short request turned into a complete ticket, the way this
// repository's own issues are written (AGENTS.md, "Issues"). The model fills in the parts, checked
// by these schemas, and the server writes the description from them, so every ticket has the same
// sections, in the same order, whichever model wrote it. The person's own words go last, under
// "Original request". The person can ask for other sections, such as "Steps to reproduce", and
// change any of them before they apply it, or later on the task's page. Every ticket ends with the
// AI's estimate of the work and why (#434), and one over 2 days comes with subtasks that split it.
import { z } from "zod";
import { TICKET_SECTIONS } from "@/lib/ai/ticket-sections";
import { estimateBody, estimateFields, estimateProblem, type SplitTask, type TaskEstimate } from "@/lib/ai/task-estimate";
import { cleanSectionTitle, escapeLine, listLine, serializeDescription, type DescriptionSection } from "@/lib/description-sections";

export { TICKET_SECTIONS };

const SUMMARY_MAX = 500;
const ITEM_MAX = 300;
const TEXT_MAX = 1000;
const MAX_ITEMS = 8;
const MAX_CRITERIA = 10;
const MAX_EXTRA_SECTIONS = 4;
const EXTRA_TITLE_MAX = 60;

const item = z.string().trim().min(1).max(ITEM_MAX);
const items = (max: number) => z.array(item).max(max);

/** The ticket's parts the model fills in: the arguments create_ticket takes besides the task's own. */
export const ticketFields = {
  summary: z.string().trim().min(1).max(SUMMARY_MAX).describe("One or two sentences: what it delivers, for whom, and why."),
  background: items(MAX_ITEMS)
    .optional()
    .describe("What's known, one point each: what the person said and what the tools found, such as related tasks. Leave out anything you'd have to guess."),
  acceptanceCriteria: items(MAX_CRITERIA)
    .min(1)
    .optional()
    .describe(
      "Testable outcomes, one each, that someone can check as done or not: what a person can do or see once it's done. For software, include the tests that prove it. Always give them, unless the person asked for a structure without them.",
    ),
  outOfScope: items(MAX_ITEMS).optional().describe("What it deliberately leaves out, when that prevents a misunderstanding."),
  openQuestions: items(MAX_ITEMS)
    .optional()
    .describe("Every decision the request leaves open and everything you assumed, as questions. Never state an assumption as a fact."),
  sections: z
    .array(
      z.strictObject({
        title: z.string().trim().min(1).max(EXTRA_TITLE_MAX).describe("The section's title, such as Steps to reproduce or Cost."),
        text: z.string().trim().max(TEXT_MAX).optional().describe("A paragraph."),
        items: items(MAX_ITEMS).optional().describe("A list, one point each."),
      }),
    )
    .max(MAX_EXTRA_SECTIONS)
    .optional()
    .describe("More sections, only when the person asked for them or for a different structure, such as Steps to reproduce, Expected result or Cost."),
  ...estimateFields("ticket"),
};

export type TicketParts = {
  summary: string;
  background?: string[];
  acceptanceCriteria?: string[];
  outOfScope?: string[];
  openQuestions?: string[];
  sections?: Array<{ title: string; text?: string; items?: string[] }>;
  /**
   * The schema always asks the model for one; without it, the ticket has no Estimate section, as
   * when it's a subtask of a task without one (#434).
   */
  estimate?: TaskEstimate;
  /** The subtasks that split work over 2 days, each with its estimate, which the description leaves to the proposal. */
  split?: SplitTask[];
};

/** Why a ticket can't be written as it is, for the model to correct it; null when it can. */
export function ticketProblem(ticket: TicketParts & { parent?: string }): string | null {
  const extra = ticket.sections?.filter((section) => section.text || section.items?.length) ?? [];
  if (!ticket.acceptanceCriteria?.length && !extra.length) {
    return "Give acceptanceCriteria: at least one testable outcome.";
  }
  const titles = [...Object.values(TICKET_SECTIONS), ...(ticket.sections ?? []).map((section) => section.title)].map((title) => cleanSectionTitle(title).toLowerCase());
  if (new Set(titles).size !== titles.length) return "Give each section its own title, different from the ticket's own sections.";
  return estimateProblem(ticket, "ticket");
}

/** Paragraphs, kept apart by blank lines, each on one line. */
function paragraphs(text: string) {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n/)
    .map((paragraph) => escapeLine(paragraph.replace(/\s+/g, " ").trim()))
    .filter(Boolean)
    .join("\n\n");
}

function list(values: string[] | undefined, checklist = false) {
  return (values ?? [])
    .map(listLine)
    .filter(Boolean)
    .map((value) => `${checklist ? "- [ ]" : "-"} ${value}`)
    .join("\n");
}

/** The person's words as a quote, line for line. */
function quote(text: string) {
  return text
    .replace(/\r\n?/g, "\n")
    .trim()
    .split("\n")
    .map((line) => (line.trim() ? `> ${line.trimEnd()}` : ">"))
    .join("\n");
}

/**
 * The ticket's description: its sections in a fixed order, the empty ones left out, and the
 * person's words (`request`, the message that asked for it) quoted at the end. A `subtask`'s
 * estimate says nothing about splitting it, since a subtask can't be split (#434).
 */
export function ticketDescription(ticket: TicketParts, request?: string, { subtask = false }: { subtask?: boolean } = {}) {
  const sections: DescriptionSection[] = [
    { title: TICKET_SECTIONS.summary, body: paragraphs(ticket.summary) },
    { title: TICKET_SECTIONS.background, body: list(ticket.background) },
    ...(ticket.sections ?? []).map((section) => ({
      title: section.title,
      body: [paragraphs(section.text ?? ""), list(section.items)].filter(Boolean).join("\n\n"),
    })),
    { title: TICKET_SECTIONS.acceptanceCriteria, body: list(ticket.acceptanceCriteria, true) },
    { title: TICKET_SECTIONS.outOfScope, body: list(ticket.outOfScope) },
    { title: TICKET_SECTIONS.openQuestions, body: list(ticket.openQuestions) },
    { title: TICKET_SECTIONS.estimate, body: ticket.estimate ? estimateBody(ticket.estimate, { subtask }) : "" },
    { title: TICKET_SECTIONS.originalRequest, body: request?.trim() ? quote(request) : "" },
  ];
  return serializeDescription({ intro: "", sections: sections.filter((section) => section.body) });
}
