// Tickets the AI assistant writes (#433): a short request turned into a complete ticket, the way this
// repository's own issues are written (AGENTS.md, "Issues"). The model fills in the parts, checked
// by these schemas, and the server writes the description from them, so every ticket has the same
// sections, in the same order, whichever model wrote it. The person's own words go last, under
// "Original request". The person can ask for other sections, such as "Steps to reproduce", and
// change any of them before they apply it, or later on the task's page. Every ticket ends with the
// AI's estimate of the work and why (#434), and one over 2 days comes with subtasks that split it.
import { z } from "zod";
import { TICKET_SECTIONS } from "@/lib/ai/ticket-sections";
import { cleanSectionTitle, serializeDescription, type DescriptionSection } from "@/lib/description-sections";
import { ESTIMATE_STEPS, SPLIT_OVER, aiEstimateLine, stepMinutes, type EstimateStep } from "@/lib/estimates";

export { TICKET_SECTIONS };

const SUMMARY_MAX = 500;
const ITEM_MAX = 300;
const TEXT_MAX = 1000;
const MAX_ITEMS = 8;
const MAX_CRITERIA = 10;
const MAX_EXTRA_SECTIONS = 4;
const EXTRA_TITLE_MAX = 60;
const REASON_MAX = 200;
const MIN_SPLIT = 2;
const MAX_SPLIT = 5;
/** As long as any task title the model writes (./tools/write-tools.ts). */
const SUBTASK_TITLE_MAX = 200;

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
  estimate: z
    .strictObject({
      size: z.enum(ESTIMATE_STEPS).describe("The nearest step. A day is 8 hours of work, and a week 5 days."),
      reason: z
        .string()
        .trim()
        .min(1)
        .max(REASON_MAX)
        .describe('One line on what the time goes to, such as "A counter, a pause and two tests in one part of sign-in."'),
    })
    .describe(
      "How long the work will take one person, tests and review included: your best guess from what the ticket describes, never a promise. The ticket shows it as the AI's estimate, and the person can change it.",
    ),
  split: z
    .array(z.string().trim().min(1).max(SUBTASK_TITLE_MAX))
    .min(MIN_SPLIT)
    .max(MAX_SPLIT)
    .optional()
    .describe(
      "Only for an estimate over 2 days, and then always: 2 to 5 subtasks that split the work, each 2 days or less, in the order they'd be done. They're offered unticked, for the person to choose.",
    ),
};

export type TicketEstimate = { size: EstimateStep; reason: string };

export type TicketParts = {
  summary: string;
  background?: string[];
  acceptanceCriteria?: string[];
  outOfScope?: string[];
  openQuestions?: string[];
  sections?: Array<{ title: string; text?: string; items?: string[] }>;
  /** The schema always asks the model for one; without it, the ticket has no Estimate section. */
  estimate?: TicketEstimate;
  /** The subtasks that split work over 2 days, which the description leaves to the proposal. */
  split?: string[];
};

/** Why a ticket can't be written as it is, for the model to correct it; null when it can. */
export function ticketProblem(ticket: TicketParts): string | null {
  const extra = ticket.sections?.filter((section) => section.text || section.items?.length) ?? [];
  if (!ticket.acceptanceCriteria?.length && !extra.length) {
    return "Give acceptanceCriteria: at least one testable outcome.";
  }
  const titles = [...Object.values(TICKET_SECTIONS), ...(ticket.sections ?? []).map((section) => section.title)].map((title) => cleanSectionTitle(title).toLowerCase());
  if (new Set(titles).size !== titles.length) return "Give each section its own title, different from the ticket's own sections.";
  const long = ticket.estimate ? stepMinutes(ticket.estimate.size) > SPLIT_OVER : false;
  if (long && (ticket.split?.length ?? 0) < MIN_SPLIT) return `The estimate is over 2 days: give split, ${MIN_SPLIT} to ${MAX_SPLIT} subtasks of 2 days or less.`;
  if (!long && ticket.split?.length) {
    return "Give split only for an estimate over 2 days. For subtasks the person asked for, call create_task with this ticket's ref as the parent.";
  }
  return null;
}

/** A line of the model's as Markdown that can't start a heading, a quote or a code block, or end the list. */
function escapeLine(text: string) {
  return text.replace(/^(\s*)(#|>|`{3}|~{3})/, "$1\\$2");
}

/** One list item: on one line, without the list marker or checkbox the model may have added. */
function listLine(text: string) {
  return escapeLine(
    text
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^(?:(?:[-*+]|\d{1,9}[.)])\s+|\[[ xX]\]\s*)+/, ""),
  );
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
 * The Estimate section (#434): the step, marked as the AI's, and the reason on the next line. Over 2
 * days, a word on splitting it, since the subtasks that would are only offered.
 */
function estimateBody({ size, reason }: TicketEstimate) {
  const lines = [aiEstimateLine(size), listLine(reason)];
  if (stepMinutes(size) > SPLIT_OVER) lines.push("", "More than 2 days of work: worth splitting into subtasks.");
  return lines.join("\n");
}

/**
 * The ticket's description: its sections in a fixed order, the empty ones left out, and the
 * person's words (`request`, the message that asked for it) quoted at the end.
 */
export function ticketDescription(ticket: TicketParts, request?: string) {
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
    { title: TICKET_SECTIONS.estimate, body: ticket.estimate ? estimateBody(ticket.estimate) : "" },
    { title: TICKET_SECTIONS.originalRequest, body: request?.trim() ? quote(request) : "" },
  ];
  return serializeDescription({ intro: "", sections: sections.filter((section) => section.body) });
}
