import { AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { BurnUpChart } from "@/components/projects/burn-up-chart";
import { uiCardClass } from "@/components/ui";
import { cn } from "@/lib/cn";
import { STALE_TASK_DAYS, type ProjectInsights as Insights } from "@/lib/project-insights";
import { formatTaskDueDateInput } from "@/lib/task-date-buckets";

const statusStyles = {
  ON_TRACK: { label: "On track", className: "bg-success-soft text-success", icon: CheckCircle2 },
  AT_RISK: { label: "At risk", className: "bg-danger-soft text-danger", icon: AlertTriangle },
  STALE: { label: "Stale", className: "bg-caution-soft text-caution", icon: Clock },
} as const;

function Tile({ label, value, detail, children }: { label: string; value: ReactNode; detail: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4" role="group" aria-label={label}>
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {children}
      <p className="mt-1 text-xs text-muted">{detail}</p>
    </div>
  );
}

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** Health and insights for one project (SMART-03). */
export function ProjectInsights({
  insights,
  counts,
}: {
  insights: Insights;
  counts: { notes: number; upcomingEvents: number };
}) {
  const style = statusStyles[insights.status];
  const StatusIcon = style.icon;
  const caption =
    insights.total === 0
      ? "Burn-up chart: no tasks yet"
      : `Burn-up chart: ${insights.done} of ${insights.total} tasks done as of today`;

  return (
    <section className="mt-8" aria-labelledby="project-insights-heading">
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 id="project-insights-heading" className="text-2xl font-semibold">
          Health and insights
        </h2>
        <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold", style.className)}>
          <StatusIcon aria-hidden="true" className="h-3.5 w-3.5" />
          {style.label}
        </span>
        <span className="text-sm text-muted">{insights.reason}</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Progress" value={`${insights.percentDone}%`} detail={`${insights.done} of ${plural(insights.total, "task")} done`}>
          <div
            className="mt-2 h-1.5 overflow-hidden rounded-full bg-accent-soft"
            role="progressbar"
            aria-label="Tasks done"
            aria-valuenow={insights.percentDone}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="h-full rounded-full bg-accent" style={{ width: `${insights.percentDone}%` }} />
          </div>
        </Tile>
        <Tile
          label="Overdue"
          value={insights.overdue}
          detail={insights.open ? `${insights.overduePercent}% of ${plural(insights.open, "open task")}` : "No open tasks"}
        />
        <Tile label="Done this week" value={insights.doneThisWeek} detail="Finished in the last 7 days" />
        <Tile label="Stale tasks" value={insights.staleTasks.length} detail={`Open, no update in ${STALE_TASK_DAYS}+ days`} />
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <div className={cn(uiCardClass, "min-w-0 p-4 lg:col-span-2")}>
          <h3 className="text-sm font-semibold">Burn-up</h3>
          <p className="mb-3 text-xs text-muted">All tasks in the project against tasks done. The gap is the work left.</p>
          <BurnUpChart
            caption={caption}
            points={insights.burnUp.map((point) => ({
              date: formatTaskDueDateInput(point.date),
              scope: point.scope,
              done: point.done,
            }))}
          />
        </div>
        <div className={cn(uiCardClass, "p-4")}>
          <h3 className="text-sm font-semibold">Needs a nudge</h3>
          {insights.staleTasks.length ? (
            <ul className="mt-2">
              {insights.staleTasks.slice(0, 5).map((task) => (
                <li key={task.id} className="border-t border-line py-2 first:border-t-0">
                  <Link href={`/tasks?task=${task.id}`} className="block truncate text-sm font-medium hover:text-accent">
                    {task.title}
                  </Link>
                  <p className="text-xs text-muted">No update in {plural(task.idleDays, "day")}</p>
                </li>
              ))}
              {insights.staleTasks.length > 5 ? (
                <li className="border-t border-line pt-2 text-xs text-muted">And {insights.staleTasks.length - 5} more</li>
              ) : null}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted">Every open task has moved in the last {STALE_TASK_DAYS} days.</p>
          )}
          <p className="mt-4 border-t border-line pt-3 text-xs text-muted">
            {plural(counts.notes, "note")} · {plural(counts.upcomingEvents, "upcoming event")}
          </p>
        </div>
      </div>
    </section>
  );
}
