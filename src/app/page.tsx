import { ArrowRight, NotebookPen, Sparkles } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { FocusList } from "@/components/home/focus-list";
import { QUICK_ADD_INPUT_ID, QuickAdd } from "@/components/home/quick-add";
import { Sparkline } from "@/components/home/sparkline";
import { LandingPage } from "@/components/landing-page";
import { uiButtonClass } from "@/components/ui";
import { getCurrentUser, isGuestLoginEnabled, isPublicSignupEnabled } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { eventWallTime, formatEventTime } from "@/lib/event-time";
import { getHomeData, type HomeEvent, type HomeProjectHealth } from "@/lib/home-data";
import { daysFrom, dueLabel, greetingFor, relativeTime, taskSummary } from "@/lib/home-summary";
import { paletteColor, projectColor } from "@/lib/project-color";
import { getUserNow, getUserTimeZone } from "@/lib/user-time-server";

const linkClass = "inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline";

function Card({ title, aside, className, children }: { title: ReactNode; aside?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={cn("rounded-xl border border-line bg-surface p-4", className)}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">{title}</h2>
        {aside ? <span className="text-xs text-muted">{aside}</span> : null}
      </div>
      {children}
    </section>
  );
}

function EmptyState({ children, action }: { children: ReactNode; action: ReactNode }) {
  return (
    <div className="grid justify-items-start gap-1.5 py-2">
      <p className="text-sm text-muted">{children}</p>
      {action}
    </div>
  );
}

function Stat({ label, value, tone, note, series, seriesLabel }: {
  label: string;
  value: number;
  tone?: "danger";
  note?: ReactNode;
  series: number[];
  seriesLabel: string;
}) {
  return (
    <div role="group" aria-label={`${label}: ${value}`} className="flex items-center justify-between gap-2 rounded-xl border border-line bg-surface px-3 py-2.5">
      <div className="min-w-0">
        <p className="truncate text-xs text-muted">{label}</p>
        <p className="flex flex-wrap items-baseline gap-x-1.5">
          <span className={cn("text-xl font-bold tabular-nums", tone === "danger" && value > 0 && "text-danger")}>{value}</span>
          {note}
        </p>
      </div>
      <span className="hidden sm:block">
        <Sparkline values={series} label={seriesLabel} />
      </span>
    </div>
  );
}

function eventRange(event: HomeEvent) {
  if (!event.hasStartTime) return "All day";
  const start = formatEventTime(event.startTime);
  return event.endTime ? `${start} to ${formatEventTime(event.endTime)}` : start;
}

function TodayTimeline({ events, now }: { events: HomeEvent[]; now: Date }) {
  const nowLabel = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(now);
  // The "now" line goes before the first timed event that hasn't started yet.
  const nextIndex = events.findIndex((event) => event.hasStartTime && eventWallTime(event.startTime) > now);
  const nowAt = nextIndex === -1 ? events.length : nextIndex;
  const nowLine = (
    <li key="now" className="col-span-2 my-0.5 flex items-center gap-1.5 text-[10.5px] font-bold text-danger" aria-label={`Now, ${nowLabel}`}>
      <span aria-hidden="true">NOW {nowLabel}</span>
      <span aria-hidden="true" className="h-px flex-1 bg-danger" />
    </li>
  );

  return (
    <ol className="grid grid-cols-[3.25rem_1fr] gap-x-2.5">
      {events.flatMap((event, index) => {
        const color = event.project ? projectColor(event.project) : "var(--accent)";
        const row = [
          <li key={event.id} className="contents">
            <span className="pt-2 text-xs tabular-nums text-muted">
              {event.hasStartTime ? formatEventTime(event.startTime).replace(/\s?[AP]M$/, "") : "All day"}
            </span>
            <Link
              href={`/events?event=${event.sourceId}`}
              className="my-1 block rounded-r-lg border-l-[3px] px-2.5 py-1.5 transition-opacity hover:opacity-80"
              style={{ borderColor: color, backgroundColor: `color-mix(in srgb, ${color} 10%, var(--surface))` }}
            >
              <span className="block truncate text-[13px] font-semibold">{event.title}</span>
              <span className="block truncate text-xs text-muted">
                {eventRange(event)}
                {event.location ? ` · ${event.location}` : ""}
              </span>
            </Link>
          </li>,
        ];
        return index === nowAt ? [nowLine, ...row] : row;
      })}
      {nowAt === events.length ? nowLine : null}
    </ol>
  );
}

const healthStyles: Record<HomeProjectHealth["status"], { label: string; className: string }> = {
  ON_TRACK: { label: "On track", className: "bg-success-soft text-success" },
  AT_RISK: { label: "At risk", className: "bg-danger-soft text-danger" },
  STALE: { label: "Stale", className: "bg-caution-soft text-caution" },
};

function healthDetail(project: HomeProjectHealth) {
  if (project.status === "STALE") return `No updates in ${project.idleDays} days`;
  const done = `${project.percentDone}% done`;
  if (project.status === "AT_RISK") return `${done} · ${project.overdueTasks} overdue`;
  if (!project.totalTasks) return "No tasks yet";
  return `${done} · ${project.doneTasks} of ${project.totalTasks} tasks`;
}

export default async function HomePage() {
  const user = await getCurrentUser();
  if (!user) {
    return <LandingPage signupEnabled={isPublicSignupEnabled()} guestLoginEnabled={isGuestLoginEnabled()} />;
  }

  // The user's wall clock, so "today" follows their time zone, not the server's (#125).
  const [now, timeZone] = await Promise.all([getUserNow(), getUserTimeZone()]);
  const home = await getHomeData(user.id, now, timeZone);
  const realNow = new Date();
  const { stats } = home;

  const firstName = user.isGuest ? null : (user.name || user.email).trim().split(/[\s@]/)[0];
  const greeting = `${greetingFor(now.getHours())}${firstName ? `, ${firstName}` : ""}`;
  const dateLine = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(now);
  const nextEvent = home.todayEvents.find((event) => event.hasStartTime && eventWallTime(event.startTime) > now);
  const eventSummary = nextEvent
    ? ` Your next event, ${nextEvent.title}, starts at ${formatEventTime(nextEvent.startTime)}.`
    : home.todayEvents.length
      ? " No more events today."
      : "";
  const weekDelta = stats.doneThisWeek - stats.doneLastWeek;
  const focusRows = home.focus.map((task) => ({
    ...task,
    dueLabel: task.dueDate ? dueLabel(task.dueDate, now) : null,
    late: Boolean(task.dueDate && daysFrom(task.dueDate, now) < 0),
  }));
  const eventCount = home.todayEvents.length;

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-4 px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted">{dateLine}</p>
          <h1 className="mt-0.5 text-2xl font-extrabold tracking-tight">{greeting}</h1>
          <p className="mt-0.5 text-sm text-muted">
            {taskSummary(stats.dueToday, stats.overdue)}
            {eventSummary}
          </p>
        </div>
        <Link href="/planner" className={cn(uiButtonClass, "px-3 py-1.5")}>
          <Sparkles aria-hidden="true" className="h-4 w-4 text-accent" />
          Plan my day
        </Link>
      </header>

      <QuickAdd />

      <section aria-label="Your numbers" className="grid grid-cols-3 gap-2 sm:gap-3">
        <Stat label="Due today" value={stats.dueToday} series={stats.dueTodaySeries} seriesLabel="Tasks due on each of the last 7 days" />
        <Stat label="Overdue" value={stats.overdue} tone="danger" series={stats.overdueSeries} seriesLabel="Overdue tasks at the end of each of the last 7 days" />
        <Stat
          label="Done this week"
          value={stats.doneThisWeek}
          series={stats.doneSeries}
          seriesLabel="Tasks completed on each of the last 7 days"
          note={
            weekDelta !== 0 ? (
              <span className={cn("hidden text-[11px] font-semibold sm:inline", weekDelta > 0 ? "text-success" : "text-muted")}>
                {weekDelta > 0 ? "+" : ""}
                {weekDelta} vs last week
              </span>
            ) : null
          }
        />
      </section>

      <div className="grid items-start gap-4 lg:grid-cols-[1.25fr_1fr]">
        <div className="grid gap-4">
          <Card title="Focus" aside={home.openTaskCount ? "Sorted by due date and priority" : undefined}>
            {focusRows.length ? (
              <>
                <FocusList tasks={focusRows} />
                {home.openTaskCount > focusRows.length ? (
                  <Link href="/tasks" className={cn(linkClass, "mt-2")}>
                    All {home.openTaskCount} open tasks <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
                  </Link>
                ) : null}
              </>
            ) : (
              <EmptyState action={<label htmlFor={QUICK_ADD_INPUT_ID} className={cn(linkClass, "cursor-pointer")}>Add your first task</label>}>
                Nothing to focus on yet.
              </EmptyState>
            )}
          </Card>

          <Card title="Today" aside={eventCount ? `${eventCount} event${eventCount === 1 ? "" : "s"}` : undefined}>
            {eventCount ? (
              <TodayTimeline events={home.todayEvents} now={now} />
            ) : (
              <EmptyState action={<Link href="/events" className={linkClass}>Plan an event</Link>}>No events today.</EmptyState>
            )}
          </Card>
        </div>

        <div className="grid gap-4">
          <Card
            title={
              <span className="flex items-center gap-1.5 text-accent">
                <Sparkles aria-hidden="true" className="h-4 w-4" />
                Suggested next
              </span>
            }
            aside="Planner"
            className="border-transparent bg-accent-soft"
          >
            {home.suggestion ? (
              <>
                <p className="text-[13px] font-semibold">{home.suggestion.title}</p>
                <p className="mt-1 text-xs text-muted">{home.suggestion.reason}</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {home.suggestion.actionHref ? (
                    <Link
                      href={home.suggestion.actionHref}
                      className="rounded-lg bg-accent px-2.5 py-1 text-xs font-semibold text-accent-ink transition-colors hover:bg-accent-hover"
                    >
                      Open
                    </Link>
                  ) : null}
                  <Link href="/planner" className="rounded-lg border border-line bg-surface px-2.5 py-1 text-xs font-semibold transition-colors hover:bg-surface-hover">
                    See the full plan
                  </Link>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted">You&apos;re all caught up. Add a task to get a suggestion.</p>
            )}
          </Card>

          <Card title="Project health" aside={home.projects.length ? "Active projects" : undefined}>
            {home.projects.length ? (
              <ul>
                {home.projects.map((project) => {
                  const style = healthStyles[project.status];
                  const color = projectColor(project);
                  return (
                    <li key={project.id} className="border-t border-line py-2 first:border-t-0">
                      <div className="flex items-center gap-2">
                        <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-[3px]" style={{ backgroundColor: color }} />
                        <Link href={`/projects/${project.id}`} className="min-w-0 flex-1 truncate text-[13px] font-semibold hover:text-accent">
                          {project.name}
                        </Link>
                        <span className={cn("shrink-0 rounded-full px-2 py-px text-[10.5px] font-bold", style.className)}>{style.label}</span>
                      </div>
                      <div
                        className="mt-1.5 h-1.5 overflow-hidden rounded-full border border-line bg-canvas"
                        role="progressbar"
                        aria-label={`${project.name} progress`}
                        aria-valuenow={project.percentDone}
                        aria-valuemin={0}
                        aria-valuemax={100}
                      >
                        <div className="h-full" style={{ width: `${project.percentDone}%`, backgroundColor: color }} />
                      </div>
                      <p className="mt-1 text-xs text-muted">{healthDetail(project)}</p>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState action={<Link href="/projects" className={linkClass}>Create your first project</Link>}>
                No active projects.
              </EmptyState>
            )}
          </Card>

          <Card title="Activity" aside={home.activity.length ? "You and your teammates" : undefined}>
            {home.activity.length ? (
              <ul className="grid gap-1">
                {home.activity.map((activity) => (
                  <li key={activity.id} className="flex items-start gap-2 py-1 text-[13px]">
                    <span
                      aria-hidden="true"
                      className="mt-px grid h-5 w-5 shrink-0 place-items-center rounded-full text-[9.5px] font-bold text-white"
                      style={{ backgroundColor: paletteColor(activity.user.id) }}
                    >
                      {activity.user.name.charAt(0).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      {activity.message}
                      {activity.project ? <span className="text-muted"> · {activity.project.name}</span> : null}
                    </span>
                    <time dateTime={activity.createdAt.toISOString()} className="shrink-0 text-xs text-muted">
                      {relativeTime(activity.createdAt, realNow)}
                    </time>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState action={<Link href="/projects" className={linkClass}>Invite a teammate</Link>}>
                Activity from you and your teammates shows up here.
              </EmptyState>
            )}
          </Card>

          {home.shortcuts.project || home.shortcuts.note ? (
            <Card title="Jump back in">
              <div className="grid gap-1.5">
                {home.shortcuts.project ? (
                  <Link href={`/projects/${home.shortcuts.project.id}`} className="flex items-center gap-2 rounded-lg px-1 py-1 text-[13px] hover:bg-surface-hover">
                    <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-[3px]" style={{ backgroundColor: projectColor(home.shortcuts.project) }} />
                    <span className="min-w-0 flex-1 truncate">
                      <span className="text-muted">Project: </span>
                      {home.shortcuts.project.name}
                    </span>
                  </Link>
                ) : null}
                {home.shortcuts.note ? (
                  <Link href={`/notes?openNote=${home.shortcuts.note.id}`} className="flex items-center gap-2 rounded-lg px-1 py-1 text-[13px] hover:bg-surface-hover">
                    <NotebookPen aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-muted" />
                    <span className="min-w-0 flex-1 truncate">
                      <span className="text-muted">Note: </span>
                      {home.shortcuts.note.title || "Untitled note"}
                    </span>
                  </Link>
                ) : null}
              </div>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
