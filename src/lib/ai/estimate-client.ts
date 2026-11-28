// What the task's page needs for the Estimate button (#540), kept apart from the request itself
// (estimate-core.ts) so the browser loads only this.
import { timeUntil } from "@/lib/ai/allowance";

/** What the task's page shows: the button, or the button saying when it's back. */
export type EstimateButtonState = { state: "ready" } | { state: "used_up"; resetsAt: string };

/** What POST /api/tasks/[id]/estimate answers with: the task as the task routes return it, and what the toast says. */
export type EstimateResponse<Task> = {
  task: Task;
  /** The task's own estimate, such as "2 h". */
  size: string;
  /** How many of its subtasks got one too. */
  subtasks: number;
};

/** What it answers when the task gets no estimate. */
export type EstimateError = {
  error?: string;
  /** "used_up": today's allowance is; "notice_required": the person hasn't agreed to the AI's data notice. */
  code?: "used_up" | "notice_required";
  /** When the allowance resets, with "used_up" (ISO 8601). */
  resetsAt?: string;
};

/** "Used up, resets in about 7 hours", beside the button once today's allowance is used up. */
export function usedUpNote(resetsAt: string, now: Date) {
  return `Used up, resets in ${timeUntil(resetsAt, now)}`;
}

/** The toast after the button: "Estimated: 2 h", and the subtasks that got one too. */
export function estimateToast({ size, subtasks }: { size: string; subtasks: number }) {
  return {
    title: `Estimated: ${size}`,
    description: subtasks ? (subtasks === 1 ? "Its subtask got an estimate too." : `Its ${subtasks} subtasks got estimates too.`) : undefined,
  };
}
