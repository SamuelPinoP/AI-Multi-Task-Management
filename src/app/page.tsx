import { NotebookPen, Sparkles } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { AvatarStack } from "@/components/home/avatar-stack";
import { FocusList } from "@/components/home/focus-list";
import { NowAndNext } from "@/components/home/now-and-next";
import { QuickAdd, QuickAddFocusButton } from "@/components/home/quick-add";
import { TeamChatList } from "@/components/home/team-chat";
import { WeekBars } from "@/components/home/week-bars";
import { LandingPage } from "@/components/landing-page";
import { uiButtonClass } from "@/components/ui";
import { getCurrentUser, isGuestLoginEnabled, isPublicSignupEnabled } from "@/lib/auth";
import { getChatSummaries } from "@/lib/chats-data";
import { cn } from "@/lib/cn";
import { eventWallTime, formatEventTime } from "@/lib/event-time";
import { getHomeData, type HomeEvent, type HomeProjectHealth } from "@/lib/home-data";
import { activityAction, daysFrom, dueLabel, greetingFor, relativeTime, taskSummary } from "@/lib/home-summary";
import { paletteColor, projectColor } from "@/lib/project-color";
import { getUserNow, getUserTimeZone } from "@/lib/user-time-server";

const linkClass = "inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline";
/** Shared projects in Home's Team chat card (DES-11). */
const TEAM_CHAT_LIMIT = 4;

/** A Home card. Cards that lead to a full page put "View all" where others put a note (DES-11). */
function Card({ title, aside, viewAll, className, children }: {
  title: ReactNode;
  aside?: ReactNode;
  viewAll?: { href: string; label: string };
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("rounded-xl border border-line bg-surface p-4 shadow-card", className)}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-1.5 text-card">{title}</h2>
        {viewAll ? (
          <Link href={viewAll.href} aria-label={viewAll.label} className="shrink-0 text-xs font-medium text-accent hover:underline">
            View all
          </Link>
        ) : aside ? (
          <span className="text-xs text-muted">{aside}</span>
        ) : null}
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

/** One number in the numbers strip, with its last 7 days as bars (DES-10). */
function Stat({ label, value, tone, note, series, seriesLabel, now }: {
  label: string;
  value: number;
  tone?: "danger";
  note?: ReactNode;
  series: number[];
  seriesLabel: string;
  now: Date;
}) {
  return (
    <div
      role="group"
      aria-label={`${label}: ${value}`}
      className="flex min-w-0 flex-col justify-between gap-1.5 bg-surface px-3 py-2.5 sm:flex-row sm:items-end sm:gap-3 sm:px-4 sm:py-3"
    >
      <div className="min-w-0">
        <p className="truncate text-2xs text-muted sm:text-xs">{label}</p>
        <p className="flex flex-wrap items-baseline gap-x-1.5">
          <span className={cn("text-xl font-semibold", tone === "danger" && value > 0 && "text-danger")}>{value}</span>
          {note}
        </p>
      </div>
      <WeekBars values={series} now={now} label={seriesLabel} />
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
    <li key="now" className="col-span-2 my-0.5 flex items-center gap-1.5 font-mono text-2xs font-semibold text-danger" aria-label={`Now, ${nowLabel}`}>
      <span aria-hidden="true">NOW {nowLabel}</span>
      <span aria-hidden="true" className="h-px flex-1 bg-danger" />
    </li>
  );

  return (
    <ol className="grid grid-cols-[3.25rem_minmax(0,1fr)] gap-x-2.5">
      {events.flatMap((event, index) => {
        const color = event.project ? projectColor(event.project) : "var(--accent)";
        const row = [
          <li key={event.id} className="contents">
            <span className="pt-2 font-mono text-xs tabular-nums text-muted">
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
  NOT_STARTED: { label: "Not started", className: "bg-sunken text-muted" },
};

function healthDetail(project: HomeProjectHealth) {
  if (project.status === "STALE") return `No updates in ${project.idleDays} days`;
  const done = `${project.percentDone}% done`;
  if (project.status === "AT_RISK") return `${done} · ${project.overdueTasks} overdue`;
  if (!project.totalTasks) return "No tasks yet";
  const tasks = `${project.totalTasks} task${project.totalTasks === 1 ? "" : "s"}`;
  if (project.status === "NOT_STARTED") return `${tasks}, none started`;
  return `${done} · ${project.doneTasks} of ${tasks}`;
}

export default async function HomePage() {
  const user = await getCurrentUser();
  if (!user) {
    return <LandingPage signupEnabled={isPublicSignupEnabled()} guestLoginEnabled={isGuestLoginEnabled()} />;
  }

  // The user's wall clock, so "today" follows their time zone, not the server's (#125).
  const [now, timeZone] = await Promise.all([getUserNow(), getUserTimeZone()]);
  // Team chat reads the Chats page's summaries: one more query on load, no polling (DES-11).
  const [home, chats] = await Promise.all([getHomeData(user.id, now, timeZone), getChatSummaries(user)]);
  const teamChats = chats.filter((chat) => chat.teammates > 0).slice(0, TEAM_CHAT_LIMIT);
  const realNow = new Date();
  const { stats } = home;

  const firstName = user.isGuest ? null : (user.name || user.email).trim().split(/[\s@]/)[0];
  const greeting = `${greetingFor(now.getHours())}${firstName ? `, ${firstName}` : ""}`;
  const dateLine = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(now);
  const weekDelta = stats.doneThisWeek - stats.doneLastWeek;
  const focusRows = home.focus.map((task) => ({
    ...task,
    dueLabel: task.dueDate ? dueLabel(task.dueDate, now) : null,
    late: Boolean(task.dueDate && daysFrom(task.dueDate, now) < 0),
  }));
  const eventCount = home.todayEvents.length;

  return (
    <div className="mx-auto grid w-full grid-cols-1 max-w-6xl gap-4 px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted">{dateLine}</p>
          <h1 className="mt-0.5 text-title">{greeting}</h1>
          <p className="mt-0.5 text-sm text-muted">{taskSummary(stats.dueToday, stats.overdue)}</p>
        </div>
        <Link href="/planner" className={cn(uiButtonClass, "px-3 py-1.5")}>
          <Sparkles aria-hidden="true" className="h-4 w-4 text-accent" />
          Plan my day
        </Link>
      </header>

      <NowAndNext band={home.band} now={now} eventCount={eventCount} />

      <section aria-label="Your numbers" className="grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-line bg-line shadow-card">
        <Stat
          label="Due today"
          value={stats.dueToday}
          series={stats.dueTodaySeries}
          seriesLabel="Tasks due on each of the last 7 days"
          now={now}
        />
        <Stat
          label="Overdue"
          value={stats.overdue}
          tone="danger"
          series={stats.overdueSeries}
          seriesLabel="Overdue tasks at the end of each of the last 7 days"
          now={now}
        />
        <Stat
          label="Done this week"
          value={stats.doneThisWeek}
          series={stats.doneSeries}
          seriesLabel="Tasks completed on each of the last 7 days"
          now={now}
          note={
            weekDelta !== 0 ? (
              <span className={cn("hidden text-2xs font-semibold sm:inline", weekDelta > 0 ? "text-success" : "text-muted")}>
                {weekDelta > 0 ? "+" : ""}
                {weekDelta} vs last week
              </span>
            ) : null
          }
        />
      </section>

      <QuickAdd />

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <div className="grid grid-cols-1 gap-4">
          <Card title="Focus" viewAll={home.openTaskCount ? { href: "/tasks", label: "View all tasks" } : undefined}>
            {focusRows.length ? (
              <FocusList tasks={focusRows} />
            ) : (
              <EmptyState action={<QuickAddFocusButton className={linkClass}>Add your first task</QuickAddFocusButton>}>
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

        <div className="grid grid-cols-1 gap-4">
          <Card title="Projects" viewAll={home.projects.length ? { href: "/projects", label: "View all projects" } : undefined}>
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
                        <span className={cn("shrink-0 rounded-full px-2 py-px text-2xs font-bold", style.className)}>{style.label}</span>
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
                      <div className="mt-1.5 flex items-center justify-between gap-2">
                        <p className="min-w-0 truncate text-xs text-muted">{healthDetail(project)}</p>
                        <AvatarStack people={project.people} label={`${project.name} members`} />
                      </div>
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

          {teamChats.length ? (
            <Card title="Team chat" viewAll={{ href: "/chats", label: "View all chats" }}>
              <TeamChatList chats={teamChats} />
            </Card>
          ) : null}

          <Card title="Activity" aside={home.activity.length ? "You and your teammates" : undefined}>
            {home.activity.length ? (
              <ul className="grid gap-1">
                {home.activity.map((activity) => (
                  <li key={activity.id} className="flex items-start gap-2 py-1 text-[13px]">
                    <span
                      aria-hidden="true"
                      className="mt-px grid h-5 w-5 shrink-0 place-items-center rounded-full text-2xs font-bold text-white"
                      style={{ backgroundColor: paletteColor(activity.user.id) }}
                    >
                      {activity.user.name.charAt(0).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="font-semibold">{activity.user.id === user.id ? "You" : activity.user.name}</span>{" "}
                      {activityAction(activity.message)}
                      {activity.project ? <span className="text-muted"> · {activity.project.name}</span> : null}
                    </span>
                    <time dateTime={activity.createdAt.toISOString()} className="shrink-0 font-mono text-xs tabular-nums text-muted">
                      {relativeTime(activity.createdAt, realNow, timeZone)}
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
              <div className="grid grid-cols-1 gap-1.5">
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
