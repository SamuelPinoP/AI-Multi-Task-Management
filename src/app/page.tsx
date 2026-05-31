import Link from "next/link";
import { uiCardClass } from "@/components/ui";
import { Recurrence, TaskStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePageUser } from "@/lib/auth";
import { expandRecurringEventsForRange } from "@/lib/recurrence";

const REMINDER_LOOKAHEAD_DAYS = 7;

const workspaceFeatures = [
  { href: "/notes", title: "Notes", description: "Capture ideas, meeting notes, and project context.", countKey: "notes", accent: "from-sky-500 to-cyan-500" },
  { href: "/tasks", title: "Tasks", description: "Plan, prioritize, assign, and complete work.", countKey: "tasks", accent: "from-emerald-500 to-teal-500" },
  { href: "/events", title: "Events", description: "Schedule time-sensitive plans and recurring events.", countKey: "events", accent: "from-violet-500 to-fuchsia-500" },
  { href: "/projects", title: "Projects", description: "Organize notes, tasks, teams, and discussions by workspace.", countKey: "projects", accent: "from-amber-500 to-orange-500" },
  { href: "/events/calendar", title: "Calendar", description: "Review deadlines and events in a calendar view.", countKey: "events", accent: "from-indigo-500 to-blue-500" },
  { href: "/tasks/board", title: "Task Board", description: "Move work through todo, in-progress, and done lanes.", countKey: "activeTasks", accent: "from-rose-500 to-pink-500" },
  { href: "/planner", title: "Planner", description: "Shape weekly goals and turn intentions into action.", countKey: "weeklyGoals", accent: "from-lime-500 to-emerald-500" },
  { href: "/roadmap", title: "Roadmap", description: "See longer-range project direction and progress.", countKey: "projects", accent: "from-purple-500 to-indigo-500" },
  { href: "/trash", title: "Trash", description: "Restore or permanently review deleted workspace items.", countKey: "trash", accent: "from-zinc-500 to-slate-500" },
] as const;

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

function getTaskReminderGroup(taskDueDate: Date, now: Date): TaskReminderGroup | null {
  const dueStart = getLocalDayStart(taskDueDate);
  const todayStart = getLocalDayStart(now);
  const dayDiff = Math.floor((dueStart.getTime() - todayStart.getTime()) / 86400000);

  if (dayDiff < 0) return "OVERDUE";
  if (dayDiff === 0) return "DUE_TODAY";
  if (dayDiff <= REMINDER_LOOKAHEAD_DAYS) return "UPCOMING";
  return null;
}

function getEventReminderGroup(startTime: Date, now: Date): EventReminderGroup | null {
  const startOfToday = getLocalDayStart(now);
  const startOfTomorrow = new Date(startOfToday);
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
  const upcomingBoundary = new Date(startOfToday);
  upcomingBoundary.setDate(upcomingBoundary.getDate() + REMINDER_LOOKAHEAD_DAYS + 1);

  if (startTime >= startOfToday && startTime < startOfTomorrow) return "TODAY";
  if (startTime >= startOfTomorrow && startTime < upcomingBoundary) return "UPCOMING";
  return null;
}

function ProjectBadge({ project }: { project: { name: string; color: string | null } | null }) {
  if (!project) return null;

  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs"
      style={project.color ? { borderColor: project.color, color: project.color } : undefined}
    >
      {project.name}
    </span>
  );
}

export default async function DashboardPage() {
  const user = await requirePageUser();

  const now = new Date();
  const todayStart = getLocalDayStart(now);
  const reminderRangeEnd = new Date(todayStart);
  reminderRangeEnd.setDate(reminderRangeEnd.getDate() + REMINDER_LOOKAHEAD_DAYS + 1);

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
    totalWeeklyGoals,
    totalTrashItems,
  ] = user
      ? await Promise.all([
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
            orderBy: [{ dueDate: "asc" }, { priority: "desc" }, { createdAt: "desc" }],
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
          prisma.task.count({ where: { userId: user.id, deletedAt: null, status: { not: TaskStatus.DONE } } }),
          prisma.task.count({ where: { userId: user.id, deletedAt: null, status: TaskStatus.DONE } }),
          prisma.event.count({ where: { userId: user.id, deletedAt: null } }),
          prisma.project.count({ where: { userId: user.id } }),
          prisma.weeklyGoal.count({ where: { userId: user.id } }),
          Promise.all([
            prisma.note.count({ where: { userId: user.id, deletedAt: { not: null } } }),
            prisma.task.count({ where: { userId: user.id, deletedAt: { not: null } } }),
            prisma.event.count({ where: { userId: user.id, deletedAt: { not: null } } }),
          ]).then((counts) => counts.reduce((total, count) => total + count, 0)),
        ])
      : [[], [], [], [], [], 0, 0, 0, 0, 0, 0, 0, 0];

  const featureCounts = {
    notes: totalNotes,
    tasks: totalTasks,
    activeTasks,
    events: totalEvents,
    projects: totalProjects,
    weeklyGoals: totalWeeklyGoals,
    trash: totalTrashItems,
  };

  const overdueTasks = reminderTasks.filter((task) => task.dueDate && getTaskReminderGroup(task.dueDate, now) === "OVERDUE");
  const dueTodayTasks = reminderTasks.filter((task) => task.dueDate && getTaskReminderGroup(task.dueDate, now) === "DUE_TODAY");
  const upcomingReminderTasks = reminderTasks.filter(
    (task) => task.dueDate && getTaskReminderGroup(task.dueDate, now) === "UPCOMING"
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
    reminderRangeEnd
  )
    .map((event) => ({ ...event, startTime: new Date(event.startTime), endTime: event.endTime ? new Date(event.endTime) : null }))
    .sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

  const todayEvents = expandedReminderEvents.filter((event) => getEventReminderGroup(event.startTime, now) === "TODAY");
  const upcomingEvents = expandedReminderEvents.filter(
    (event) => getEventReminderGroup(event.startTime, now) === "UPCOMING"
  );

  const hasUrgentReminders =
    overdueTasks.length > 0 || dueTodayTasks.length > 0 || upcomingReminderTasks.length > 0 || todayEvents.length > 0 || upcomingEvents.length > 0;

  return (
    <main className="min-h-screen px-6 py-10">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="mb-2 text-sm font-medium text-zinc-500 dark:text-zinc-400">{user.isGuest ? "Guest mode" : "Workspace"}</p>
            <h1 className="text-4xl font-bold">Dashboard</h1>
            <p className="mt-2 text-zinc-600 dark:text-zinc-300">
              Welcome to AI-Multi Task-Management. Here&apos;s a quick look at your productivity.
            </p>
          </div>
          {user.isGuest ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-200">
              You&apos;re using a database-backed guest workspace. Keep this browser session to keep access.
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
            <article key={item.label} className="rounded-2xl border border-zinc-200 p-5 shadow-sm dark:border-zinc-800">
              <p className="text-sm text-zinc-500 dark:text-zinc-400">{item.label}</p>
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

          {!user ? (
            <p className="text-zinc-600 dark:text-zinc-300">Demo user not found.</p>
          ) : !hasUrgentReminders ? (
            <p className="rounded-xl border border-dashed border-zinc-300 p-4 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">
              There are no urgent reminders.
            </p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              <article className="rounded-xl border border-red-200 bg-red-50/60 p-4 dark:border-red-900/60 dark:bg-red-950/20">
                <h3 className="font-semibold text-red-700 dark:text-red-300">Overdue Tasks</h3>
                {overdueTasks.length === 0 ? <p className="mt-2 text-sm text-zinc-500">None</p> : <ul className="mt-3 space-y-2">{overdueTasks.map((task) => <li key={task.id} className="rounded-lg border border-red-100 bg-white/70 p-3 dark:border-red-900/40 dark:bg-zinc-900/30"><p className="font-medium">{task.title}</p><p className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">Due {formatDate(task.dueDate as Date)} · {task.priority} · {task.status.replace("_", " ")}</p><div className="mt-2"><ProjectBadge project={task.project} /></div></li>)}</ul>}
              </article>

              <article className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 dark:border-amber-900/60 dark:bg-amber-950/20">
                <h3 className="font-semibold text-amber-700 dark:text-amber-300">Due Today</h3>
                {dueTodayTasks.length === 0 ? <p className="mt-2 text-sm text-zinc-500">None</p> : <ul className="mt-3 space-y-2">{dueTodayTasks.map((task) => <li key={task.id} className="rounded-lg border border-amber-100 bg-white/70 p-3 dark:border-amber-900/40 dark:bg-zinc-900/30"><p className="font-medium">{task.title}</p><p className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">Due {formatDate(task.dueDate as Date)} · {task.priority} · {task.status.replace("_", " ")}</p><div className="mt-2"><ProjectBadge project={task.project} /></div></li>)}</ul>}
              </article>

              <article className="rounded-xl border border-blue-200 bg-blue-50/60 p-4 dark:border-blue-900/60 dark:bg-blue-950/20">
                <h3 className="font-semibold text-blue-700 dark:text-blue-300">Upcoming Tasks</h3>
                {upcomingReminderTasks.length === 0 ? <p className="mt-2 text-sm text-zinc-500">None</p> : <ul className="mt-3 space-y-2">{upcomingReminderTasks.map((task) => <li key={task.id} className="rounded-lg border border-blue-100 bg-white/70 p-3 dark:border-blue-900/40 dark:bg-zinc-900/30"><p className="font-medium">{task.title}</p><p className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">Due {formatDate(task.dueDate as Date)} · {task.priority} · {task.status.replace("_", " ")}</p><div className="mt-2"><ProjectBadge project={task.project} /></div></li>)}</ul>}
              </article>

              <article className="rounded-xl border border-violet-200 bg-violet-50/60 p-4 dark:border-violet-900/60 dark:bg-violet-950/20">
                <h3 className="font-semibold text-violet-700 dark:text-violet-300">Today&apos;s Events</h3>
                {todayEvents.length === 0 ? <p className="mt-2 text-sm text-zinc-500">None</p> : <ul className="mt-3 space-y-2">{todayEvents.map((event) => <li key={event.id} className="rounded-lg border border-violet-100 bg-white/70 p-3 dark:border-violet-900/40 dark:bg-zinc-900/30"><p className="font-medium">{event.title}</p><p className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">{formatDate(event.startTime)}</p><div className="mt-2"><ProjectBadge project={event.project ?? null} /></div></li>)}</ul>}
              </article>

              <article className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 dark:border-emerald-900/60 dark:bg-emerald-950/20 md:col-span-2">
                <h3 className="font-semibold text-emerald-700 dark:text-emerald-300">Upcoming Events</h3>
                {upcomingEvents.length === 0 ? <p className="mt-2 text-sm text-zinc-500">None</p> : <ul className="mt-3 grid gap-2 md:grid-cols-2">{upcomingEvents.map((event) => <li key={event.id} className="rounded-lg border border-emerald-100 bg-white/70 p-3 dark:border-emerald-900/40 dark:bg-zinc-900/30"><p className="font-medium">{event.title}</p><p className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">{formatDate(event.startTime)}</p><div className="mt-2"><ProjectBadge project={event.project ?? null} /></div></li>)}</ul>}
              </article>
            </div>
          )}
        </section>

        <section className={`${uiCardClass} mb-10`}>
          <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Navigation hub</p>
              <h2 className="text-2xl font-semibold">Open your workspace tools</h2>
            </div>
            <p className="max-w-xl text-sm text-zinc-600 dark:text-zinc-300">
              Major destinations live here as clear feature cards so the top bar can stay focused on search, today, account, and theme controls.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {workspaceFeatures.map((feature) => (
              <Link
                key={feature.href}
                href={feature.href}
                className="group rounded-2xl border border-zinc-200 bg-zinc-50/80 p-4 transition hover:-translate-y-0.5 hover:border-zinc-300 hover:bg-white hover:shadow-md hover:shadow-zinc-200/70 dark:border-zinc-800 dark:bg-zinc-950/40 dark:hover:border-zinc-700 dark:hover:bg-zinc-900 dark:hover:shadow-none"
              >
                <div className="mb-4 flex items-center justify-between gap-3">
                  <span className={`h-10 w-10 rounded-2xl bg-gradient-to-br ${feature.accent} shadow-sm`} aria-hidden="true" />
                  <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-zinc-600 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-800">
                    {featureCounts[feature.countKey]}
                  </span>
                </div>
                <h3 className="text-lg font-semibold group-hover:underline group-hover:underline-offset-4">{feature.title}</h3>
                <p className="mt-2 min-h-10 text-sm leading-5 text-zinc-600 dark:text-zinc-300">{feature.description}</p>
                <p className="mt-4 text-sm font-medium text-zinc-950 dark:text-zinc-50">Open {feature.title} →</p>
              </Link>
            ))}
          </div>
        </section>

        <section className={`${uiCardClass} mb-10`}>
          <h2 className="mb-4 text-2xl font-semibold">Recent Activity</h2>
          {!user ? (
            <p className="text-zinc-600 dark:text-zinc-300">Demo user not found.</p>
          ) : recentActivities.length === 0 ? (
            <p className="text-zinc-600 dark:text-zinc-300">No recent activity yet.</p>
          ) : (
            <ul className="space-y-3">
              {recentActivities.map((activity) => (
                <li key={activity.id} className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
                  <p className="font-medium">{activity.message}</p>
                  <div className="mt-2 flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                    <span>{formatDate(activity.createdAt)}</span>
                    {activity.project ? <ProjectBadge project={activity.project} /> : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-2xl border border-zinc-200 p-6 shadow-sm dark:border-zinc-800">
            <h2 className="mb-4 text-2xl font-semibold">Recent Notes</h2>
            {!user ? (
              <p className="text-zinc-600 dark:text-zinc-300">Demo user not found.</p>
            ) : recentNotes.length === 0 ? (
              <p className="text-zinc-600 dark:text-zinc-300">No notes yet. Create one to get started.</p>
            ) : (
              <ul className="space-y-3">
                {recentNotes.map((note) => (
                  <li key={note.id} className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
                    <p className="font-medium">{note.title}</p>
                    {note.content ? (
                      <p className="mt-1 line-clamp-2 text-sm text-zinc-600 dark:text-zinc-300">{note.content}</p>
                    ) : (
                      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">No content.</p>
                    )}
                    <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">Created {formatDate(note.createdAt)}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-2xl border border-zinc-200 p-6 shadow-sm dark:border-zinc-800">
            <h2 className="mb-4 text-2xl font-semibold">Upcoming Tasks</h2>
            {!user ? (
              <p className="text-zinc-600 dark:text-zinc-300">Demo user not found.</p>
            ) : upcomingTasks.length === 0 ? (
              <p className="text-zinc-600 dark:text-zinc-300">No upcoming tasks with due dates.</p>
            ) : (
              <ul className="space-y-3">
                {upcomingTasks.map((task) => (
                  <li key={task.id} className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
                    <div className="flex items-start justify-between gap-3">
                      <p className="font-medium">{task.title}</p>
                      <span className="rounded-lg bg-zinc-100 px-2 py-1 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                        {task.priority}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">Status: {task.status.replace("_", " ")}</p>
                    {task.dueDate && <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Due {formatDate(task.dueDate)}</p>}
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
