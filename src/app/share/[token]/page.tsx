import { CalendarClock, CheckCircle2, Circle, CircleDot } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { BurnUpChart } from "@/components/projects/burn-up-chart";
import { GithubPanel } from "@/components/projects/github-panel";
import { uiCardClass } from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatEventDateTime } from "@/lib/event-time";
import { projectInsights } from "@/lib/project-insights";
import { findSharedProject } from "@/lib/project-share";
import { describeRepeat, expandRecurringEventsForRange, type RecurrenceValue } from "@/lib/recurrence";
import { formatTaskDueDateInput, getLocalDateOnly, isOverdueTask } from "@/lib/task-date-buckets";
import { toWallClock } from "@/lib/user-time";
import { getUserTimeZone } from "@/lib/user-time-server";

/**
 * A project's public, read-only roadmap (SMART-12), for an advisor or a
 * recruiter. It shows the name, description, progress, task titles with their
 * status and due dates, upcoming events and the linked GitHub repository.
 * Notes, chat, files, members, assignees and task descriptions stay private.
 */

type PageProps = { params: Promise<{ token: string }> };

const COLUMN_LIMIT = 25;
const UPCOMING_DAYS = 60;

const statusLabels = { ACTIVE: "Active", COMPLETED: "Completed", ARCHIVED: "Archived" } as const;

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { token } = await params;
  const project = await findSharedProject(token, { name: true });
  return {
    title: project ? `${project.name} · AI Multi` : "Shared project · AI Multi",
    // For the people the link is sent to, not for search engines. Links out
    // mustn't carry the token in a Referer header either.
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
}

const mediumDate = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });

function formatEventDate(event: { startTime: string; hasStartTime: boolean }) {
  if (event.hasStartTime) return formatEventDateTime(event.startTime);
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(event.startTime));
}

function Tile({ label, value, detail }: { label: string; value: ReactNode; detail: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4" role="group" aria-label={label}>
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      <p className="mt-1 text-xs text-muted">{detail}</p>
    </div>
  );
}

export default async function SharedProjectPage({ params }: PageProps) {
  const { token } = await params;
  const project = await findSharedProject(token, {
    name: true,
    description: true,
    color: true,
    status: true,
    updatedAt: true,
    githubRepo: true,
    tasks: {
      where: { deletedAt: null },
      orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
      select: { id: true, title: true, status: true, dueDate: true, createdAt: true, updatedAt: true, completedAt: true, parentId: true },
    },
    events: {
      where: { deletedAt: null },
      select: { id: true, title: true, startTime: true, endTime: true, hasStartTime: true, hasEndTime: true, recurrence: true, repeatUntil: true, skippedDates: true },
    },
  });
  if (!project) notFound();

  const timeZone = await getUserTimeZone();
  const wall = (instant: Date) => toWallClock(timeZone, instant);
  const now = wall(new Date());
  const insights = projectInsights(
    project.tasks.map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      dueDate: task.dueDate,
      createdAt: wall(task.createdAt),
      updatedAt: wall(task.updatedAt),
      completedAt: task.completedAt ? wall(task.completedAt) : null,
    })),
    { updatedAt: wall(project.updatedAt) },
    now,
  );

  // The roadmap lists top-level tasks; subtasks show as a count on their parent.
  const subtaskCounts = new Map<string, { done: number; total: number }>();
  for (const task of project.tasks) {
    if (!task.parentId) continue;
    const count = subtaskCounts.get(task.parentId) ?? { done: 0, total: 0 };
    count.total += 1;
    if (task.status === "DONE") count.done += 1;
    subtaskCounts.set(task.parentId, count);
  }
  const topLevel = project.tasks.filter((task) => !task.parentId);
  const columns = [
    { title: "In progress", icon: CircleDot, tasks: topLevel.filter((task) => task.status === "IN_PROGRESS") },
    { title: "Up next", icon: Circle, tasks: topLevel.filter((task) => task.status === "TODO") },
    {
      title: "Done",
      icon: CheckCircle2,
      tasks: topLevel
        .filter((task) => task.status === "DONE")
        .sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0)),
    },
  ];

  const rangeStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const rangeEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + UPCOMING_DAYS, 23, 59, 59);
  const upcoming = expandRecurringEventsForRange(
    project.events.map((event) => ({
      ...event,
      // Occurrences get their own ids; this one stays the event's.
      eventId: event.id,
      recurrence: event.recurrence as RecurrenceValue,
      startTime: event.startTime.toISOString(),
      endTime: event.endTime?.toISOString() ?? null,
      repeatUntil: event.repeatUntil?.toISOString() ?? null,
    })),
    rangeStart,
    rangeEnd,
  )
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
    // Each event once, at its next date; a weekly check-in shouldn't fill the list.
    .filter((event, index, all) => all.findIndex((other) => other.eventId === event.eventId) === index)
    .slice(0, 8);

  return (
    <main className="px-4 pb-16 pt-4 sm:px-6">
      <div className="mx-auto max-w-5xl">
        <header className={uiCardClass}>
          <p className="text-sm font-medium text-muted">Read-only roadmap</p>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <span
              aria-hidden="true"
              className="h-3.5 w-3.5 shrink-0 rounded-full border border-line"
              style={{ backgroundColor: project.color || "transparent" }}
            />
            <h1 className="text-title">{project.name}</h1>
            <span className="rounded-full border border-line px-2 py-0.5 text-xs">{statusLabels[project.status]}</span>
          </div>
          {project.description ? <p className="mt-3 max-w-3xl whitespace-pre-line text-ink/90">{project.description}</p> : null}
          <p className="mt-3 text-xs text-muted">
            Updated {mediumDate.format(wall(project.updatedAt))}
          </p>
        </header>

        <section className="mt-8" aria-labelledby="progress-heading">
          <h2 id="progress-heading" className="mb-4 text-2xl font-semibold">
            Progress
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tile label="Done" value={`${insights.percentDone}%`} detail={`${insights.done} of ${insights.total} tasks`} />
            <Tile label="Open" value={insights.open} detail="Tasks still to do" />
            <Tile label="Overdue" value={insights.overdue} detail="Open tasks past their due date" />
            <Tile label="Done this week" value={insights.doneThisWeek} detail="Finished in the last 7 days" />
          </div>
          {insights.total ? (
            <div className={cn(uiCardClass, "mt-3 min-w-0 p-4")}>
              <h3 className="text-sm font-semibold">Burn-up</h3>
              <p className="mb-3 text-xs text-muted">All tasks against tasks done. The gap is the work left.</p>
              <BurnUpChart
                caption={`Burn-up chart: ${insights.done} of ${insights.total} tasks done as of today`}
                points={insights.burnUp.map((point) => ({
                  date: formatTaskDueDateInput(point.date),
                  scope: point.scope,
                  done: point.done,
                }))}
              />
            </div>
          ) : null}
        </section>

        <section className="mt-8" aria-labelledby="roadmap-heading">
          <h2 id="roadmap-heading" className="mb-4 text-2xl font-semibold">
            Roadmap
          </h2>
          {topLevel.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-line p-5 text-muted">No tasks yet.</p>
          ) : (
            <div className="grid gap-3 lg:grid-cols-3">
              {columns.map((column) => (
                <section key={column.title} className={cn(uiCardClass, "p-4")} aria-label={column.title}>
                  <h3 className="flex items-center gap-2 text-sm font-semibold">
                    <column.icon aria-hidden="true" className="h-4 w-4 text-muted" />
                    {column.title}
                    <span className="text-muted">{column.tasks.length}</span>
                  </h3>
                  {column.tasks.length === 0 ? (
                    <p className="mt-2 text-sm text-muted">Nothing here.</p>
                  ) : (
                    <ul className="mt-2">
                      {column.tasks.slice(0, COLUMN_LIMIT).map((task) => {
                        const subtasks = subtaskCounts.get(task.id);
                        const overdue = task.status !== "DONE" && isOverdueTask(task.dueDate, now);
                        return (
                          <li key={task.id} className="border-t border-line py-2 first:border-t-0">
                            <p className={cn("text-sm font-medium", task.status === "DONE" && "text-muted line-through")}>{task.title}</p>
                            <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted">
                              {task.dueDate ? (
                                <span className={cn(overdue && "font-semibold text-danger")}>
                                  {overdue ? "Overdue: " : "Due "}
                                  {mediumDate.format(getLocalDateOnly(task.dueDate))}
                                </span>
                              ) : null}
                              {subtasks ? (
                                <span>
                                  {subtasks.done} of {subtasks.total} subtasks done
                                </span>
                              ) : null}
                            </p>
                          </li>
                        );
                      })}
                      {column.tasks.length > COLUMN_LIMIT ? (
                        <li className="border-t border-line pt-2 text-xs text-muted">And {column.tasks.length - COLUMN_LIMIT} more</li>
                      ) : null}
                    </ul>
                  )}
                </section>
              ))}
            </div>
          )}
        </section>

        <section className="mt-8" aria-labelledby="upcoming-heading">
          <h2 id="upcoming-heading" className="mb-4 text-2xl font-semibold">
            Coming up
          </h2>
          {upcoming.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-line p-5 text-muted">Nothing on the calendar in the next {UPCOMING_DAYS} days.</p>
          ) : (
            <ul className={cn(uiCardClass, "p-4")}>
              {upcoming.map((event) => (
                <li key={event.eventId} className="flex items-start gap-3 border-t border-line py-2 first:border-t-0">
                  <CalendarClock aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
                  <div>
                    <p className="text-sm font-medium">{event.title}</p>
                    <p className="text-xs text-muted">
                      {formatEventDate(event)}
                      {event.recurrence !== "NONE" ? ` · ${describeRepeat(event.recurrence, event.repeatUntil)}` : ""}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {project.githubRepo ? <GithubPanel endpoint={`/api/share/${token}/github`} repo={project.githubRepo} /> : null}

        <footer className="mt-10 border-t border-line pt-4 text-sm text-muted">
          Shared read-only from{" "}
          <Link href="/" className="font-medium text-accent hover:underline">
            AI Multi
          </Link>
          . Only what&apos;s on this page is shared.
        </footer>
      </div>
    </main>
  );
}
