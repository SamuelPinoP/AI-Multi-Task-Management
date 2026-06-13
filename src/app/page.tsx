import Link from "next/link";
import { uiCardClass, uiPrimaryButtonClass } from "@/components/ui";
import { Recurrence, TaskStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  getCurrentUser,
  isGuestLoginEnabled,
  isPublicSignupEnabled,
} from "@/lib/auth";
import { expandRecurringEventsForRange } from "@/lib/recurrence";
import { projectAccessWhere } from "@/lib/project-access";

const REMINDER_LOOKAHEAD_DAYS = 7;

const landingFeatures = [
  {
    title: "Notes",
    description:
      "Capture research notes, meeting takeaways, and project context, then connect them to projects when helpful.",
  },
  {
    title: "Tasks",
    description:
      "Track priorities, due dates, recurrence, assignments, and status from a list or a visual board.",
  },
  {
    title: "Projects",
    description:
      "Organize team workspaces with members, workload summaries, quick actions, calendars, and shared task context.",
  },
  {
    title: "Team collaboration",
    description:
      "Invite registered collaborators, show owner/shared access clearly, and keep member notes and permissions understandable.",
  },
  {
    title: "Project chat + attachments",
    description:
      "Discuss decisions and blockers in project chat, pin key messages, and attach files through local or Vercel Blob storage.",
  },
  {
    title: "Planner and Today",
    description:
      "Use focused Today, Planner, Roadmap, and Calendar views to understand what needs attention next.",
  },
];

const demoFeatures = [
  "Database-backed auth/session flow",
  "Real project invitations and collaboration labels",
  "Project chat with file attachments",
  "Task board, Today, Planner, and Roadmap views",
];

function LandingPage({
  signupEnabled,
  guestLoginEnabled,
}: {
  signupEnabled: boolean;
  guestLoginEnabled: boolean;
}) {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(99,102,241,0.18),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(16,185,129,0.14),transparent_32%)] px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-12">
        <section className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
          <div className="space-y-7">
            <div className="inline-flex rounded-full border border-zinc-200 bg-white/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-600 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-300">
              AI-Multi Task-Management
            </div>
            <div className="space-y-4">
              <h1 className="max-w-4xl text-4xl font-bold tracking-tight text-zinc-950 dark:text-zinc-50 sm:text-6xl">
                A polished workspace for notes, tasks, projects, and team
                execution.
              </h1>
              <p className="max-w-2xl text-lg leading-8 text-zinc-600 dark:text-zinc-300">
                Plan class projects, capstones, and team work in one place:
                capture notes, manage tasks, coordinate projects, chat with
                collaborators, attach files, and focus each day with Today and
                Planner views.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Link
                href="/login"
                className={`${uiPrimaryButtonClass} justify-center px-5 py-3`}
              >
                Log in
              </Link>
              {signupEnabled ? (
                <Link
                  href="/signup"
                  className="inline-flex items-center justify-center rounded-xl border border-zinc-300 bg-white/90 px-5 py-3 text-sm font-semibold text-zinc-900 shadow-sm transition hover:-translate-y-0.5 hover:bg-white dark:border-zinc-700 dark:bg-zinc-900/80 dark:text-zinc-50 dark:hover:bg-zinc-900"
                >
                  Sign up
                </Link>
              ) : (
                <span className="inline-flex items-center justify-center rounded-xl border border-amber-200 bg-amber-50 px-5 py-3 text-sm font-medium text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-200">
                  Signup is restricted on this deployment
                </span>
              )}
              {guestLoginEnabled ? (
                <form action="/api/auth/guest" method="post">
                  <button
                    type="submit"
                    className="inline-flex w-full items-center justify-center rounded-xl border border-zinc-300 bg-white/80 px-5 py-3 text-sm font-semibold text-zinc-900 shadow-sm transition hover:-translate-y-0.5 hover:bg-white dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-50 dark:hover:bg-zinc-900 sm:w-auto"
                  >
                    Continue as guest
                  </button>
                </form>
              ) : (
                <span className="inline-flex items-center justify-center rounded-xl border border-zinc-200 bg-white/70 px-5 py-3 text-sm font-medium text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-300">
                  Guest access is disabled
                </span>
              )}
            </div>
            {!signupEnabled || !guestLoginEnabled ? (
              <p className="max-w-2xl rounded-2xl border border-zinc-200 bg-white/75 px-4 py-3 text-sm text-zinc-600 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-300">
                Access can be intentionally restricted for demos or class
                review. Use a provided account, or ask the workspace owner to
                enable signup/guest access.
              </p>
            ) : null}
          </div>

          <div className="rounded-[2rem] border border-zinc-200 bg-white/85 p-5 shadow-2xl shadow-zinc-300/40 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/75 dark:shadow-none">
            <div className="rounded-[1.5rem] border border-zinc-200 bg-zinc-50 p-5 dark:border-zinc-800 dark:bg-zinc-950/70">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                    Demo dashboard
                  </p>
                  <h2 className="mt-1 text-2xl font-semibold">
                    What reviewers can evaluate quickly
                  </h2>
                </div>
                <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                  Demo-ready
                </span>
              </div>
              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                {demoFeatures.map((feature) => (
                  <div
                    key={feature}
                    className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm font-medium text-zinc-700 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200"
                  >
                    {feature}
                  </div>
                ))}
              </div>
              <div className="mt-5 rounded-2xl bg-zinc-900 p-4 text-sm leading-6 text-zinc-200 dark:bg-zinc-100 dark:text-zinc-800">
                Built with Next.js, React, TypeScript, Prisma, and PostgreSQL,
                with deployment-ready docs and Vercel-friendly storage support.
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {landingFeatures.map((feature) => (
            <article
              key={feature.title}
              className="rounded-3xl border border-zinc-200 bg-white/85 p-6 shadow-sm backdrop-blur transition hover:-translate-y-1 hover:shadow-lg dark:border-zinc-800 dark:bg-zinc-900/70"
            >
              <h2 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">
                {feature.title}
              </h2>
              <p className="mt-3 text-sm leading-6 text-zinc-600 dark:text-zinc-300">
                {feature.description}
              </p>
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}

type TaskReminderGroup = "OVERDUE" | "DUE_TODAY" | "UPCOMING";
type EventReminderGroup = "TODAY" | "UPCOMING";

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function getLocalDayStart(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function getTaskReminderGroup(
  taskDueDate: Date,
  now: Date,
): TaskReminderGroup | null {
  const dueStart = getLocalDayStart(taskDueDate);
  const todayStart = getLocalDayStart(now);
  const dayDiff = Math.floor(
    (dueStart.getTime() - todayStart.getTime()) / 86400000,
  );

  if (dayDiff < 0) return "OVERDUE";
  if (dayDiff === 0) return "DUE_TODAY";
  if (dayDiff <= REMINDER_LOOKAHEAD_DAYS) return "UPCOMING";
  return null;
}

function getEventReminderGroup(
  startTime: Date,
  now: Date,
): EventReminderGroup | null {
  const startOfToday = getLocalDayStart(now);
  const startOfTomorrow = new Date(startOfToday);
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
  const upcomingBoundary = new Date(startOfToday);
  upcomingBoundary.setDate(
    upcomingBoundary.getDate() + REMINDER_LOOKAHEAD_DAYS + 1,
  );

  if (startTime >= startOfToday && startTime < startOfTomorrow) return "TODAY";
  if (startTime >= startOfTomorrow && startTime < upcomingBoundary)
    return "UPCOMING";
  return null;
}

function ProjectBadge({
  project,
}: {
  project: { name: string; color: string | null } | null;
}) {
  if (!project) return null;

  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs"
      style={
        project.color
          ? { borderColor: project.color, color: project.color }
          : undefined
      }
    >
      {project.name}
    </span>
  );
}

export default async function DashboardPage() {
  const user = await getCurrentUser();

  if (!user) {
    return (
      <LandingPage
        signupEnabled={isPublicSignupEnabled()}
        guestLoginEnabled={isGuestLoginEnabled()}
      />
    );
  }

  const now = new Date();
  const todayStart = getLocalDayStart(now);
  const reminderRangeEnd = new Date(todayStart);
  reminderRangeEnd.setDate(
    reminderRangeEnd.getDate() + REMINDER_LOOKAHEAD_DAYS + 1,
  );

  const [
    recentNotes,
    recentActivities,
    upcomingTasks,
    reminderTasks,
    reminderEvents,
    totalNotes,
    totalTasks,
    activeTasks,
    completedTasks,
    totalEvents,
    totalProjects,
  ] = await Promise.all([
    prisma.note.findMany({
      where: { userId: user.id, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    prisma.activity.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: {
        project: {
          select: { name: true, color: true },
        },
      },
    }),
    prisma.task.findMany({
      where: {
        userId: user.id,
        deletedAt: null,
        dueDate: { not: null },
        status: { not: TaskStatus.DONE },
      },
      orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
      take: 5,
      include: { project: { select: { name: true, color: true } } },
    }),
    prisma.task.findMany({
      where: {
        userId: user.id,
        deletedAt: null,
        dueDate: { not: null },
        status: { not: TaskStatus.DONE },
      },
      orderBy: [
        { dueDate: "asc" },
        { priority: "desc" },
        { createdAt: "desc" },
      ],
      include: { project: { select: { name: true, color: true } } },
    }),
    prisma.event.findMany({
      where: {
        userId: user.id,
        deletedAt: null,
        startTime: { gte: todayStart },
      },
      orderBy: { startTime: "asc" },
      include: { project: { select: { name: true, color: true } } },
    }),
    prisma.note.count({ where: { userId: user.id, deletedAt: null } }),
    prisma.task.count({ where: { userId: user.id, deletedAt: null } }),
    prisma.task.count({
      where: {
        userId: user.id,
        deletedAt: null,
        status: { not: TaskStatus.DONE },
      },
    }),
    prisma.task.count({
      where: { userId: user.id, deletedAt: null, status: TaskStatus.DONE },
    }),
    prisma.event.count({ where: { userId: user.id, deletedAt: null } }),
    prisma.project.count({ where: projectAccessWhere(user.id) }),
  ]);

  const overdueTasks = reminderTasks.filter(
    (task) =>
      task.dueDate && getTaskReminderGroup(task.dueDate, now) === "OVERDUE",
  );
  const dueTodayTasks = reminderTasks.filter(
    (task) =>
      task.dueDate && getTaskReminderGroup(task.dueDate, now) === "DUE_TODAY",
  );
  const upcomingReminderTasks = reminderTasks.filter(
    (task) =>
      task.dueDate && getTaskReminderGroup(task.dueDate, now) === "UPCOMING",
  );

  const recurringCandidates = reminderEvents.map((event) => ({
    ...event,
    startTime: event.startTime.toISOString(),
    endTime: event.endTime?.toISOString() ?? null,
    recurrence: event.recurrence ?? Recurrence.NONE,
    sourceEventId: event.id,
  }));

  const expandedReminderEvents = expandRecurringEventsForRange(
    recurringCandidates,
    todayStart,
    reminderRangeEnd,
  )
    .map((event) => ({
      ...event,
      startTime: new Date(event.startTime),
      endTime: event.endTime ? new Date(event.endTime) : null,
    }))
    .sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

  const todayEvents = expandedReminderEvents.filter(
    (event) => getEventReminderGroup(event.startTime, now) === "TODAY",
  );
  const upcomingEvents = expandedReminderEvents.filter(
    (event) => getEventReminderGroup(event.startTime, now) === "UPCOMING",
  );

  const hasUrgentReminders =
    overdueTasks.length > 0 ||
    dueTodayTasks.length > 0 ||
    upcomingReminderTasks.length > 0 ||
    todayEvents.length > 0 ||
    upcomingEvents.length > 0;

  return (
    <main className="min-h-screen px-6 py-10">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="mb-2 text-sm font-medium text-zinc-500 dark:text-zinc-400">
              {user.isGuest ? "Guest mode" : "Workspace"}
            </p>
            <h1 className="text-4xl font-bold">Dashboard</h1>
            <p className="mt-2 text-zinc-600 dark:text-zinc-300">
              Welcome to AI-Multi Task-Management. Here&apos;s a quick look at
              your productivity.
            </p>
          </div>
          {user.isGuest ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-200">
              You&apos;re using a database-backed guest workspace. Keep this
              browser session to keep access.
            </div>
          ) : null}
        </div>

        <section className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: "Total Notes", value: totalNotes },
            { label: "Total Tasks", value: totalTasks },
            { label: "Active Tasks", value: activeTasks },
            { label: "Completed Tasks", value: completedTasks },
          ].map((item) => (
            <article
              key={item.label}
              className="rounded-2xl border border-zinc-200 p-5 shadow-sm dark:border-zinc-800"
            >
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                {item.label}
              </p>
              <p className="mt-2 text-3xl font-semibold">{item.value}</p>
            </article>
          ))}
        </section>

        <section className="mb-8 rounded-2xl border border-zinc-200 p-6 shadow-sm dark:border-zinc-800">
          <div className="mb-4 flex items-start justify-between gap-3">
            <h2 className="text-2xl font-semibold">Reminders</h2>
            <span className="rounded-full bg-zinc-100 px-2 py-1 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              Next {REMINDER_LOOKAHEAD_DAYS} days
            </span>
          </div>

          {!hasUrgentReminders ? (
            <p className="rounded-xl border border-dashed border-zinc-300 p-4 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">
              There are no urgent reminders.
            </p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              <article className="rounded-xl border border-red-200 bg-red-50/60 p-4 dark:border-red-900/60 dark:bg-red-950/20">
                <h3 className="font-semibold text-red-700 dark:text-red-300">
                  Overdue Tasks
                </h3>
                {overdueTasks.length === 0 ? (
                  <p className="mt-2 text-sm text-zinc-500">None</p>
                ) : (
                  <ul className="mt-3 space-y-2">
                    {overdueTasks.map((task) => (
                      <li
                        key={task.id}
                        className="rounded-lg border border-red-100 bg-white/70 p-3 dark:border-red-900/40 dark:bg-zinc-900/30"
                      >
                        <p className="font-medium">{task.title}</p>
                        <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">
                          Due {formatDate(task.dueDate as Date)} ·{" "}
                          {task.priority} · {task.status.replace("_", " ")}
                        </p>
                        <div className="mt-2">
                          <ProjectBadge project={task.project} />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </article>

              <article className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 dark:border-amber-900/60 dark:bg-amber-950/20">
                <h3 className="font-semibold text-amber-700 dark:text-amber-300">
                  Due Today
                </h3>
                {dueTodayTasks.length === 0 ? (
                  <p className="mt-2 text-sm text-zinc-500">None</p>
                ) : (
                  <ul className="mt-3 space-y-2">
                    {dueTodayTasks.map((task) => (
                      <li
                        key={task.id}
                        className="rounded-lg border border-amber-100 bg-white/70 p-3 dark:border-amber-900/40 dark:bg-zinc-900/30"
                      >
                        <p className="font-medium">{task.title}</p>
                        <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">
                          Due {formatDate(task.dueDate as Date)} ·{" "}
                          {task.priority} · {task.status.replace("_", " ")}
                        </p>
                        <div className="mt-2">
                          <ProjectBadge project={task.project} />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </article>

              <article className="rounded-xl border border-blue-200 bg-blue-50/60 p-4 dark:border-blue-900/60 dark:bg-blue-950/20">
                <h3 className="font-semibold text-blue-700 dark:text-blue-300">
                  Upcoming Tasks
                </h3>
                {upcomingReminderTasks.length === 0 ? (
                  <p className="mt-2 text-sm text-zinc-500">None</p>
                ) : (
                  <ul className="mt-3 space-y-2">
                    {upcomingReminderTasks.map((task) => (
                      <li
                        key={task.id}
                        className="rounded-lg border border-blue-100 bg-white/70 p-3 dark:border-blue-900/40 dark:bg-zinc-900/30"
                      >
                        <p className="font-medium">{task.title}</p>
                        <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">
                          Due {formatDate(task.dueDate as Date)} ·{" "}
                          {task.priority} · {task.status.replace("_", " ")}
                        </p>
                        <div className="mt-2">
                          <ProjectBadge project={task.project} />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </article>

              <article className="rounded-xl border border-violet-200 bg-violet-50/60 p-4 dark:border-violet-900/60 dark:bg-violet-950/20">
                <h3 className="font-semibold text-violet-700 dark:text-violet-300">
                  Today&apos;s Events
                </h3>
                {todayEvents.length === 0 ? (
                  <p className="mt-2 text-sm text-zinc-500">None</p>
                ) : (
                  <ul className="mt-3 space-y-2">
                    {todayEvents.map((event) => (
                      <li
                        key={event.id}
                        className="rounded-lg border border-violet-100 bg-white/70 p-3 dark:border-violet-900/40 dark:bg-zinc-900/30"
                      >
                        <p className="font-medium">{event.title}</p>
                        <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">
                          {formatDate(event.startTime)}
                        </p>
                        <div className="mt-2">
                          <ProjectBadge project={event.project ?? null} />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </article>

              <article className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 dark:border-emerald-900/60 dark:bg-emerald-950/20 md:col-span-2">
                <h3 className="font-semibold text-emerald-700 dark:text-emerald-300">
                  Upcoming Events
                </h3>
                {upcomingEvents.length === 0 ? (
                  <p className="mt-2 text-sm text-zinc-500">None</p>
                ) : (
                  <ul className="mt-3 grid gap-2 md:grid-cols-2">
                    {upcomingEvents.map((event) => (
                      <li
                        key={event.id}
                        className="rounded-lg border border-emerald-100 bg-white/70 p-3 dark:border-emerald-900/40 dark:bg-zinc-900/30"
                      >
                        <p className="font-medium">{event.title}</p>
                        <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">
                          {formatDate(event.startTime)}
                        </p>
                        <div className="mt-2">
                          <ProjectBadge project={event.project ?? null} />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            </div>
          )}
        </section>

        <section className={`${uiCardClass} mb-10`}>
          <div className="grid gap-5 md:grid-cols-[1.2fr_0.8fr] md:items-center">
            <div>
              <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
                Productivity snapshot
              </p>
              <h2 className="mt-1 text-2xl font-semibold">
                Keep the day in focus
              </h2>
              <p className="mt-3 text-sm leading-6 text-zinc-600 dark:text-zinc-300">
                Use this dashboard to scan current workload, upcoming reminders,
                recent changes, and the newest notes without repeating every
                workspace destination.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              {[
                { label: "Events", value: totalEvents },
                { label: "Projects", value: totalProjects },
              ].map((item) => (
                <div
                  key={item.label}
                  className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950/50"
                >
                  <p className="text-zinc-500 dark:text-zinc-400">
                    {item.label}
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-zinc-950 dark:text-zinc-50">
                    {item.value}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className={`${uiCardClass} mb-10`}>
          <h2 className="mb-4 text-2xl font-semibold">Recent Activity</h2>
          {recentActivities.length === 0 ? (
            <p className="text-zinc-600 dark:text-zinc-300">
              No recent activity yet.
            </p>
          ) : (
            <ul className="space-y-3">
              {recentActivities.map((activity) => (
                <li
                  key={activity.id}
                  className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
                >
                  <p className="font-medium">{activity.message}</p>
                  <div className="mt-2 flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                    <span>{formatDate(activity.createdAt)}</span>
                    {activity.project ? (
                      <ProjectBadge project={activity.project} />
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-2xl border border-zinc-200 p-6 shadow-sm dark:border-zinc-800">
            <h2 className="mb-4 text-2xl font-semibold">Recent Notes</h2>
            {recentNotes.length === 0 ? (
              <p className="text-zinc-600 dark:text-zinc-300">
                No notes yet. Create one to get started.
              </p>
            ) : (
              <ul className="space-y-3">
                {recentNotes.map((note) => (
                  <li
                    key={note.id}
                    className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
                  >
                    <p className="font-medium">{note.title}</p>
                    {note.content ? (
                      <p className="mt-1 line-clamp-2 text-sm text-zinc-600 dark:text-zinc-300">
                        {note.content}
                      </p>
                    ) : (
                      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                        No content.
                      </p>
                    )}
                    <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                      Created {formatDate(note.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-2xl border border-zinc-200 p-6 shadow-sm dark:border-zinc-800">
            <h2 className="mb-4 text-2xl font-semibold">Upcoming Tasks</h2>
            {upcomingTasks.length === 0 ? (
              <p className="text-zinc-600 dark:text-zinc-300">
                No upcoming tasks with due dates.
              </p>
            ) : (
              <ul className="space-y-3">
                {upcomingTasks.map((task) => (
                  <li
                    key={task.id}
                    className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="font-medium">{task.title}</p>
                      <span className="rounded-lg bg-zinc-100 px-2 py-1 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                        {task.priority}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
                      Status: {task.status.replace("_", " ")}
                    </p>
                    {task.dueDate && (
                      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                        Due {formatDate(task.dueDate)}
                      </p>
                    )}
                    <div className="mt-2">
                      <ProjectBadge project={task.project} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
