import { Sparkles } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { QuickAddFocusButton } from "@/components/home/quick-add";
import { StartTaskButton } from "@/components/home/start-task-button";
import { cn } from "@/lib/cn";
import { formatEventTime } from "@/lib/event-time";
import type { HomeData } from "@/lib/home-data";
import { daysFrom, dueLabel, formatMinutes } from "@/lib/home-summary";

const titleClass = "mt-1 line-clamp-2 break-words text-sm font-semibold";
const detailClass = "mt-0.5 text-xs text-muted";
const linkClass = "mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline";
const buttonClass = "rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors";

function Part({ label, className, children }: { label: ReactNode; className?: string; children: ReactNode }) {
  return (
    <div className={cn("min-w-0 bg-surface p-3 sm:px-4", className)}>
      <h2 className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-muted">{label}</h2>
      {children}
    </div>
  );
}

/**
 * Home's "Now and next" band (DES-10): the event under way (or the top Focus
 * task), the next event today, and the planner's suggestion with Start.
 */
export function NowAndNext({ band, now, eventCount }: { band: HomeData["band"]; now: Date; eventCount: number }) {
  if (band.empty) {
    return (
      <section
        aria-label="Now and next"
        className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-line bg-surface px-4 py-3 shadow-card"
      >
        <p className="text-sm text-muted">No events today and no open tasks.</p>
        <QuickAddFocusButton className="text-sm font-medium text-accent hover:underline">Add a task</QuickAddFocusButton>
      </section>
    );
  }

  const { current, task, next, suggestion, suggestionTask } = band;
  const minutesUntil = (date: Date) => (date.getTime() - now.getTime()) / 60_000;

  let nowPart: ReactNode;
  if (current?.end && current.endTime) {
    const left = formatMinutes(minutesUntil(current.end));
    const elapsed = (now.getTime() - current.start.getTime()) / (current.end.getTime() - current.start.getTime());
    const percent = Math.round(Math.min(1, Math.max(0, elapsed)) * 100);
    nowPart = (
      <>
        <Link href={`/events?event=${current.sourceId}`} className={cn(titleClass, "hover:text-accent")}>
          {current.title}
        </Link>
        <p className={detailClass}>
          <span className="whitespace-nowrap">{left} left</span> ·{" "}
          <span className="whitespace-nowrap">until {formatEventTime(current.endTime)}</span>
        </p>
        <div
          role="progressbar"
          aria-label={`${current.title} progress`}
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuetext={`${left} left`}
          className="mt-2 h-1.5 overflow-hidden rounded-full bg-accent-soft"
        >
          <div className="h-full rounded-full bg-accent" style={{ width: `${percent}%` }} />
        </div>
      </>
    );
  } else if (task) {
    const late = Boolean(task.dueDate && daysFrom(task.dueDate, now) < 0);
    nowPart = (
      <>
        <Link href={`/tasks?task=${task.id}`} className={cn(titleClass, "hover:text-accent")}>
          {task.title}
        </Link>
        <p className={detailClass}>
          Top of your list
          {task.dueDate ? (
            <>
              {" · "}
              <span className={cn(late && "font-semibold text-danger")}>{dueLabel(task.dueDate, now)}</span>
            </>
          ) : null}
        </p>
      </>
    );
  } else {
    nowPart = (
      <>
        <p className={titleClass}>Free right now</p>
        <p className={detailClass}>No open tasks</p>
      </>
    );
  }

  return (
    <section
      aria-label="Now and next"
      className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line shadow-card md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.35fr)]"
    >
      <Part
        label={
          <>
            {current ? <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-danger" /> : null}
            Now
          </>
        }
      >
        {nowPart}
      </Part>

      <Part label="Next">
        {next ? (
          <>
            <Link href={`/events?event=${next.sourceId}`} className={cn(titleClass, "hover:text-accent")}>
              {next.title}
            </Link>
            <p className={detailClass}>
              <span className="whitespace-nowrap">{formatEventTime(next.startTime)}</span> ·{" "}
              <span className="whitespace-nowrap">in {formatMinutes(minutesUntil(next.start))}</span>
            </p>
          </>
        ) : (
          <>
            <p className={titleClass}>{eventCount ? "No more events today" : "No events today"}</p>
            <Link href="/events/calendar" className={linkClass}>
              Open calendar
            </Link>
          </>
        )}
      </Part>

      <Part
        label={
          <span className="flex items-center gap-1.5 text-accent">
            <Sparkles aria-hidden="true" className="h-3.5 w-3.5" />
            Suggested next
          </span>
        }
        className="col-span-2 bg-accent-soft md:col-span-1"
      >
        {suggestion ? (
          <>
            <p className={titleClass}>{suggestion.title}</p>
            <p className={cn(detailClass, "line-clamp-2")}>{suggestion.reason}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {suggestionTask && suggestion.actionHref ? (
                <StartTaskButton
                  task={suggestionTask}
                  href={suggestion.actionHref}
                  className={cn(buttonClass, "bg-accent text-accent-ink hover:bg-accent-hover disabled:opacity-60")}
                />
              ) : suggestion.actionHref ? (
                <Link href={suggestion.actionHref} className={cn(buttonClass, "bg-accent text-accent-ink hover:bg-accent-hover")}>
                  Open
                </Link>
              ) : null}
              <Link href="/planner" className={cn(buttonClass, "border border-line bg-surface hover:bg-surface-hover")}>
                See the full plan
              </Link>
            </div>
          </>
        ) : (
          <>
            <p className={titleClass}>Nothing else lined up</p>
            <Link href="/planner" className={linkClass}>
              See the full plan
            </Link>
          </>
        )}
      </Part>
    </section>
  );
}
