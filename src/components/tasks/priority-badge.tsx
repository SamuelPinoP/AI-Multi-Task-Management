import { cn } from "@/lib/cn";
import { priorityBadgeLabels, priorityLabels, type Priority } from "@/lib/priority";

/**
 * A task's priority as a small badge (#361): Urgent filled red, High outlined
 * red, Medium and Low quiet. No priority shows nothing. `muted` greys it out,
 * for tasks that are done.
 */
export function PriorityBadge({ priority, muted = false, className }: { priority: Priority; muted?: boolean; className?: string }) {
  if (priority === "NONE") return null;
  return (
    <span
      title={`${priorityLabels[priority]} priority`}
      className={cn(
        "shrink-0 rounded border px-1.5 text-2xs font-bold",
        muted || (priority !== "URGENT" && priority !== "HIGH")
          ? "border-line bg-canvas text-muted"
          : priority === "URGENT"
            ? "border-danger/60 bg-danger-soft text-danger"
            : "border-danger/35 text-danger",
        className,
      )}
    >
      {priorityBadgeLabels[priority]}
      <span className="sr-only"> priority</span>
    </span>
  );
}
