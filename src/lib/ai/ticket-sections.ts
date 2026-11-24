// The sections of a ticket the AI assistant writes (#433), and how the chat's card sums up a new
// task's description in sections: a ticket, or a task with the AI's estimate (#434). Kept apart
// from ./ticket.ts, which checks what the model wrote, so the browser needs no schemas.
import { ESTIMATE_SECTION, descriptionPreview, listItems, parseDescription } from "@/lib/description-sections";

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

export type DraftOverview = {
  /** A ticket, which has a Summary; otherwise a task with sections, such as the AI's estimate (#434). */
  ticket: boolean;
  /** Its first text: a ticket's summary, or a task's details. Never the estimate; "" for none. */
  summary: string;
  /** "3 acceptance criteria · 1 open question"; "" when it has neither. */
  facts: string;
};

/**
 * A new task's description in sections as the card sums it up, and opens it as a draft: a ticket,
 * or a task with the AI's estimate. Null for a plain one, which has no draft.
 */
export function draftOverview(description: string | null | undefined): DraftOverview | null {
  if (!description) return null;
  const { sections } = parseDescription(description);
  if (!sections.length) return null;
  const find = (title: string) => sections.find((candidate) => candidate.title.trim().toLowerCase() === title.toLowerCase());
  const count = (title: string, one: string, many: string) => {
    const section = find(title);
    const items = section ? listItems(section.body).length : 0;
    return items ? `${items} ${items === 1 ? one : many}` : null;
  };
  const facts = [
    count(TICKET_SECTIONS.acceptanceCriteria, "acceptance criterion", "acceptance criteria"),
    count(TICKET_SECTIONS.openQuestions, "open question", "open questions"),
  ].filter(Boolean);
  return { ticket: find(TICKET_SECTIONS.summary) !== undefined, summary: descriptionPreview(description), facts: facts.join(" · ") };
}
