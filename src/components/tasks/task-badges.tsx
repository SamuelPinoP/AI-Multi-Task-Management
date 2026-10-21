import { Lock } from "lucide-react";
import { cn } from "@/lib/cn";

/** Subtask progress as a small ring with "2/5" (SMART-02). */
export function ProgressRing({ done, total, className }: { done: number; total: number; className?: string }) {
  const size = 16;
  const radius = (size - 3) / 2;
  const circumference = 2 * Math.PI * radius;
  const ratio = total ? done / total : 0;

  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 text-[11px] tabular-nums text-muted", className)} title={`${done} of ${total} subtasks done`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--accent-soft)" strokeWidth={2.5} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - ratio)}
        />
      </svg>
      <span aria-hidden="true">
        {done}/{total}
      </span>
      <span className="sr-only">
        {done} of {total} subtasks done
      </span>
    </span>
  );
}

/** "Blocked" while the task waits on open tasks; the tooltip and screen readers name them. */
export function BlockedBadge({ titles, className }: { titles: string[]; className?: string }) {
  const waitingOn = `Waiting on ${titles.map((title) => `“${title}”`).join(", ")}`;
  return (
    <span
      title={waitingOn}
      className={cn("inline-flex shrink-0 items-center gap-1 rounded bg-caution-soft px-1.5 text-[10px] font-bold text-caution", className)}
    >
      <Lock aria-hidden="true" className="h-2.5 w-2.5" />
      <span aria-hidden="true">Blocked</span>
      <span className="sr-only">Blocked. {waitingOn}</span>
    </span>
  );
}
