// The AI's estimate for each task it creates (#434), as create_task and create_ticket take it: one
// of the fixed steps with a one-line reason and, for work over 2 days, 2 to 5 subtasks that split
// it, each with its own estimate. The server writes the Estimate section from them, so it reads the
// same whichever model wrote it. Subtasks follow their parent: the tools leave the estimate out of a
// subtask whose parent has none (./tools/write-tools.ts).
import { z } from "zod";
import { listLine, parseDescription, serializeDescription } from "@/lib/description-sections";
import { ESTIMATE_SECTION, ESTIMATE_STEPS, SPLIT_OVER, aiEstimateLine, isEstimateSection, stepMinutes, type EstimateStep } from "@/lib/estimates";

const REASON_MAX = 200;
const MIN_SPLIT = 2;
const MAX_SPLIT = 5;
/** As long as any task title the model writes (./tools/write-tools.ts). */
const SUBTASK_TITLE_MAX = 200;

/** The steps a subtask that splits bigger work can take: 2 days or less. */
export const SPLIT_STEPS = ESTIMATE_STEPS.filter((step) => stepMinutes(step) <= SPLIT_OVER);

export type TaskEstimate = { size: EstimateStep; reason: string };

/** A subtask that splits work over 2 days, with its own estimate. */
export type SplitTask = TaskEstimate & { title: string };

const reason = (what: string) => z.string().trim().min(1).max(REASON_MAX).describe(what);

/** The arguments create_task and create_ticket take for the estimate. `noun` is what the tool proposes. */
export function estimateFields(noun: "task" | "ticket") {
  return {
    estimate: z
      .strictObject({
        size: z.enum(ESTIMATE_STEPS).describe("The nearest step. A day is 8 hours of work, and a week 5 days."),
        reason: reason(
          `One line on what the time goes to, such as "${noun === "ticket" ? "A counter, a pause and two tests in one part of sign-in." : "Two coats on the fence, with drying time in between."}"`,
        ),
      })
      .describe(
        noun === "ticket"
          ? "How long the work will take one person, tests and review included: your best guess from what the ticket describes, never a promise. The ticket shows it as the AI's estimate, and the person can change it."
          : "How long it will take one person: your best guess from what the person said, never a promise. Always give one. The task shows it as the AI's estimate, and the person can change it.",
      ),
    split: z
      .array(
        z.strictObject({
          title: z.string().trim().min(1).max(SUBTASK_TITLE_MAX).describe("The subtask's title."),
          size: z.enum(SPLIT_STEPS).describe("Its own estimate: the nearest step."),
          reason: reason("One line on what its time goes to."),
        }),
      )
      .min(MIN_SPLIT)
      .max(MAX_SPLIT)
      .optional()
      .describe(
        "Only for an estimate over 2 days, and then always, unless it's a subtask: 2 to 5 subtasks that split the work, each 2 days or less, in the order they'd be done. They're offered unticked, for the person to choose.",
      ),
  };
}

/**
 * Why an estimate and its split can't be proposed as they are, for the model to correct them; null
 * when they can. Work over 2 days needs its split, unless it's a subtask, which can't have
 * subtasks of its own; shorter work gets none.
 */
export function estimateProblem({ estimate, split, parent }: { estimate?: TaskEstimate; split?: SplitTask[]; parent?: string }, noun: "task" | "ticket") {
  const long = estimate ? stepMinutes(estimate.size) > SPLIT_OVER : false;
  if (long && !parent && (split?.length ?? 0) < MIN_SPLIT) return `The estimate is over 2 days: give split, ${MIN_SPLIT} to ${MAX_SPLIT} subtasks of 2 days or less.`;
  if (!long && split?.length) {
    return `Give split only for an estimate over 2 days. For subtasks the person asked for, call create_task with this ${noun}'s ref as the parent.`;
  }
  return null;
}

/**
 * The Estimate section: the step, marked as the AI's, and the reason on the next line. Over 2 days,
 * a word on splitting it, since the subtasks that would are only offered; a subtask can't be split.
 */
export function estimateBody({ size, reason }: TaskEstimate, { subtask = false }: { subtask?: boolean } = {}) {
  const lines = [aiEstimateLine(size), listLine(reason)];
  if (stepMinutes(size) > SPLIT_OVER && !subtask) lines.push("", "More than 2 days of work: worth splitting into subtasks.");
  return lines.join("\n");
}

/**
 * A new task's description with the AI's estimate: the details the model gave, then the Estimate
 * section. A plain description keeps its text above the new section, as the task's page keeps it
 * when a section is added (#433), and an Estimate section the model wrote itself gives way to it.
 * Without an estimate, the details stay as they are.
 */
export function withEstimate(details: string | null, estimate: TaskEstimate | undefined, options: { subtask?: boolean } = {}): string | null {
  if (!estimate) return details;
  const { intro, sections } = parseDescription(details ?? "");
  return serializeDescription({
    intro,
    sections: [...sections.filter((section) => !isEstimateSection(section.title)), { title: ESTIMATE_SECTION, body: estimateBody(estimate, options) }],
  });
}
