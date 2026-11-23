// The sections of a ticket the AI assistant writes (#433), and how the chat's card sums one up.
// Kept apart from ./ticket.ts, which checks what the model wrote, so the browser needs no schemas.
import { descriptionPreview, listItems, parseDescription } from "@/lib/description-sections";
import { ESTIMATE_SECTION } from "@/lib/estimates";

/** The sections every ticket has, in order, as they're titled in its description. */
export const TICKET_SECTIONS = {
  summary: "Summary",
  background: "Background",
  acceptanceCriteria: "Acceptance criteria",
  outOfScope: "Out of scope",
  openQuestions: "Open questions",
  /** The AI's estimate of the work and why (#434). */
  estimate: ESTIMATE_SECTION,
  originalRequest: "Original request",
} as const;

export type TicketOverview = {
  /** Its first text, normally the summary. */
  summary: string;
  /** "3 acceptance criteria · 1 open question"; "" when it has neither. */
  facts: string;
};

/** A description in sections as the card sums it up; null for a plain one, which isn't a ticket. */
export function ticketOverview(description: string | null | undefined): TicketOverview | null {
  if (!description) return null;
  const { sections } = parseDescription(description);
  if (!sections.length) return null;
  const count = (title: string, one: string, many: string) => {
    const section = sections.find((candidate) => candidate.title.toLowerCase() === title.toLowerCase());
    const items = section ? listItems(section.body).length : 0;
    return items ? `${items} ${items === 1 ? one : many}` : null;
  };
  const facts = [
    count(TICKET_SECTIONS.acceptanceCriteria, "acceptance criterion", "acceptance criteria"),
    count(TICKET_SECTIONS.openQuestions, "open question", "open questions"),
  ].filter(Boolean);
  return { summary: descriptionPreview(description), facts: facts.join(" · ") };
}
