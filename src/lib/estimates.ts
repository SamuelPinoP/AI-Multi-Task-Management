// Time estimates (#434): how long a task's work will take, as the AI judges it from the request.
// Every task the AI creates gets one: the AI picks one of fixed steps and says why in one line, and
// the app writes both into the task's "Estimate" section, marked as the AI's. So the estimate is
// read and changed like the rest of the description, in the draft and on the task's page, and never
// shows on the task's row. Once a person changes it, it's theirs and the mark goes. Subtasks follow
// their parent: one under a task without an estimate gets none. A day is 8 hours of work and a week
// 5 days, as people plan them. Plain functions, so the server, the task page, the evaluations and
// the unit tests share them.
import { ESTIMATE_SECTION, isEstimateSection, parseDescription } from "@/lib/description-sections";

export { ESTIMATE_SECTION, isEstimateSection };

/** The steps the AI picks from, shortest first. */
export const ESTIMATE_STEPS = ["15 min", "30 min", "1 h", "2 h", "4 h", "1 day", "2 days", "3 days", "1 week"] as const;

export type EstimateStep = (typeof ESTIMATE_STEPS)[number];

/** What follows an estimate the AI made until a person changes it: "4 h · AI estimate". */
export const AI_ESTIMATE = "AI estimate";

const HOUR = 60;
const DAY = 8 * HOUR;
const WEEK = 5 * DAY;

/** Work longer than this, in minutes (2 days), is worth splitting into subtasks. */
export const SPLIT_OVER = 2 * DAY;

const STEP_MINUTES: Record<EstimateStep, number> = {
  "15 min": 15,
  "30 min": 30,
  "1 h": HOUR,
  "2 h": 2 * HOUR,
  "4 h": 4 * HOUR,
  "1 day": DAY,
  "2 days": 2 * DAY,
  "3 days": 3 * DAY,
  "1 week": WEEK,
};

/** A step in minutes: "2 h" is 120. */
export function stepMinutes(step: EstimateStep) {
  return STEP_MINUTES[step];
}

/** Units people write after an amount of time, each in minutes: "min", "h", "hours", "days", "wk". */
const UNITS: Array<[RegExp, number]> = [
  [/^m(?:ins?|inutes?)?$/, 1],
  [/^h(?:rs?|ours?)?$/, HOUR],
  [/^d(?:ays?)?$/, DAY],
  [/^w(?:ks?|eeks?)?$/, WEEK],
];

/**
 * The first amount of time in `text`, in minutes: "4 h", "90 min", "1.5 days" and "2 weeks" read
 * as 240, 90, 720 and 4800. Null when it has none, such as "Pack the kitchen" or "2 tests".
 */
export function parseDuration(text: string): number | null {
  for (const match of text.matchAll(/(?<![\w.,])(\d+(?:[.,]\d+)?)[ \t]*([a-z]+)\b/gi)) {
    const unit = UNITS.find(([pattern]) => pattern.test(match[2].toLowerCase()));
    if (unit) return Math.round(Number(match[1].replace(",", ".")) * unit[1]);
  }
  return null;
}

/** The Estimate section's first line as the AI writes it: "**4 h** · AI estimate". */
export function aiEstimateLine(step: EstimateStep) {
  return `**${step}** · ${AI_ESTIMATE}`;
}

/** The AI's mark after an estimate, with the separator before it. */
const AI_MARK = new RegExp(`[ \\t]*·[ \\t]*${AI_ESTIMATE}\\b`, "i");

export type Estimate = {
  /** In minutes. */
  minutes: number;
  /** Whether it's the AI's, which no person has changed. */
  ai: boolean;
};

/**
 * Whether a description has an estimate: an Estimate section with something in it, in a person's
 * words or the AI's. A subtask the AI adds gets an estimate only when its parent has one.
 */
export function hasEstimate(description: string | null | undefined) {
  if (!description) return false;
  return parseDescription(description).sections.some((section) => isEstimateSection(section.title) && section.body.trim() !== "");
}

/**
 * The estimate a description gives: the time on the first line of its Estimate section, where the
 * AI writes it. Null when it has none, so a later line, such as the note on splitting work over 2
 * days, is never read as the estimate.
 */
export function descriptionEstimate(description: string | null | undefined): Estimate | null {
  if (!description) return null;
  const section = parseDescription(description).sections.find((candidate) => isEstimateSection(candidate.title));
  const firstLine = section?.body.split("\n")[0] ?? "";
  const minutes = parseDuration(firstLine);
  return minutes === null ? null : { minutes, ai: AI_MARK.test(firstLine) };
}

/**
 * A person's edit of an Estimate section. Once they change it, the estimate is theirs, so the AI's
 * mark goes: "**4 h** · AI estimate" becomes "**6 h**". Saved unchanged, it stays the AI's.
 */
export function ownEstimate(before: string, after: string) {
  return after.trim() === before.trim() ? after : after.replace(AI_MARK, "");
}
