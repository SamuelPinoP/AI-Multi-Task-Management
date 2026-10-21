type Status = "TODO" | "IN_PROGRESS" | "DONE";

/**
 * The `completedAt` to store when a task's status goes from `previous` to `next`
 * (BUG-11). `undefined` means "leave it as it is", so editing a finished task's
 * title doesn't move its completion date.
 */
export function nextCompletedAt(previous: Status, next: Status, now: Date = new Date()): Date | null | undefined {
  if (next !== "DONE") return null;
  return previous === "DONE" ? undefined : now;
}
