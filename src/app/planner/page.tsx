import Link from "next/link";
import { Priority, Recurrence, TaskStatus } from "@prisma/client";
import { uiCardClass } from "@/components/ui";
import { prisma } from "@/lib/prisma";
import { expandRecurringEventsForRange, normalizeRecurrence } from "@/lib/recurrence";

const DEMO_USER_EMAIL = "samuel@example.com";
const FOCUS_LIMIT = 8;
const TODAY_TASK_LIMIT = 5;

type PlannerTask = {
  id: string;
  title: string;
  dueDate: Date | null;
  status: TaskStatus;
  priority: Priority;
  project: { name: string; color: string | null } | null;
};

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function getLocalDayStart(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function getDayDiff(target: Date, now: Date) {
  const targetStart = getLocalDayStart(target);
  const nowStart = getLocalDayStart(now);
  return Math.floor((targetStart.getTime() - nowStart.getTime()) / 86400000);
}

function getTaskScore(task: PlannerTask, now: Date) {
  let score = 0;
  const dayDiff = task.dueDate ? getDayDiff(task.dueDate, now) : null;

  if (dayDiff !== null) {
    if (dayDiff < 0) score += 120;
    else if (dayDiff === 0) score += 90;
    else if (dayDiff <= 2) score += 50;
    else if (dayDiff <= 7) score += 25;
  }

  if (task.priority === Priority.HIGH) score += 35;
  if (task.priority === Priority.MEDIUM) score += 15;
  if (task.status === TaskStatus.IN_PROGRESS) score += 10;

  return score;
}

function getTaskUrgencyLabel(task: PlannerTask, now: Date) {
  if (!task.dueDate) return "No due date";
  const dayDiff = getDayDiff(task.dueDate, now);
  if (dayDiff < 0) return "Overdue";
  if (dayDiff === 0) return "Due today";
  if (dayDiff <= 2) return "Due soon";
  return "Upcoming";
}

function getPlanReason(tasks: PlannerTask[], now: Date) {
  const overdueHigh = tasks.some((task) => task.dueDate && getDayDiff(task.dueDate, now) < 0 && task.priority === Priority.HIGH);
  if (overdueHigh) return "Start with overdue high-priority work.";

  const dueToday = tasks.some((task) => task.dueDate && getDayDiff(task.dueDate, now) === 0);
  if (dueToday) return "Handle due-today tasks before lower urgency work.";

  const highPriority = tasks.some((task) => task.priority === Priority.HIGH);
  if (highPriority) return "Prioritize high-priority items to reduce risk later in the week.";

  return "No urgent tasks today; make steady progress on active work.";
}

function ProjectBadge({ project }: { project: { name: string; color: string | null } | null }) {
  if (!project) return <span className="text-xs text-zinc-500 dark:text-zinc-400">No project</span>;
  return (
    <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs" style={project.color ? { borderColor: project.color, color: project.color } : undefined}>
      {project.name}
    </span>
  );
}

export default async function PlannerPage() {
  const user = await prisma.user.findUnique({ where: { email: DEMO_USER_EMAIL }, select: { id: true } });
  const now = new Date();
  const todayStart = getLocalDayStart(now);
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);

  const [activeTasks, plannerEvents, projects] = user
    ? await Promise.all([
        prisma.task.findMany({
          where: { userId: user.id, deletedAt: null, status: { not: TaskStatus.DONE } },
          include: { project: { select: { name: true, color: true } } },
        }),
        prisma.event.findMany({
          where: { userId: user.id, deletedAt: null },
          orderBy: { startTime: "asc" },
          include: { project: { select: { name: true, color: true } } },
        }),
        prisma.project.findMany({
          where: { userId: user.id },
          select: {
            id: true,
            name: true,
            color: true,
            tasks: { where: { deletedAt: null }, select: { id: true, status: true, dueDate: true } },
            events: { where: { deletedAt: null, startTime: { gte: todayStart } }, select: { id: true } },
          },
        }),
      ])
    : [[], [], []];

  const activeEvents = plannerEvents.filter((event) => event.deletedAt === null);
  const recurringCandidates = activeEvents.map((event) => ({
    ...event,
    startTime: event.startTime.toISOString(),
    endTime: event.endTime ? event.endTime.toISOString() : null,
    recurrence: normalizeRecurrence(event.recurrence ?? Recurrence.NONE),
  }));
  const todaysEvents = expandRecurringEventsForRange(recurringCandidates, todayStart, tomorrowStart).sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

  const scoredTasks = activeTasks
    .map((task) => ({ ...task, score: getTaskScore(task, now), urgencyLabel: getTaskUrgencyLabel(task, now) }))
    .sort((a, b) => b.score - a.score || Number(b.priority === Priority.HIGH) - Number(a.priority === Priority.HIGH));

  const recommendedFocusTasks = scoredTasks.slice(0, FOCUS_LIMIT);
  const suggestedTodayTasks = scoredTasks.slice(0, TODAY_TASK_LIMIT);
  const planReason = getPlanReason(suggestedTodayTasks, now);

  const projectInsights = projects
    .map((project) => {
      const activeTaskCount = project.tasks.filter((task) => task.status !== TaskStatus.DONE).length;
      const completedTaskCount = project.tasks.filter((task) => task.status === TaskStatus.DONE).length;
      const overdueTaskCount = project.tasks.filter((task) => task.status !== TaskStatus.DONE && task.dueDate && getDayDiff(task.dueDate, now) < 0).length;
      const completionPercent = project.tasks.length === 0 ? 0 : Math.round((completedTaskCount / project.tasks.length) * 100);
      const needsAttention = overdueTaskCount > 0 || activeTaskCount >= 5;
      return { ...project, activeTaskCount, overdueTaskCount, upcomingEventCount: project.events.length, completionPercent, needsAttention };
    })
    .sort((a, b) => Number(b.needsAttention) - Number(a.needsAttention) || b.overdueTaskCount - a.overdueTaskCount);

  return <main className="min-h-screen px-6 py-10"><div className="mx-auto max-w-5xl space-y-8"><header><h1 className="text-4xl font-bold">Smart Planner</h1><p className="mt-2 text-zinc-600 dark:text-zinc-300">Rule-based planning using your tasks, events, projects, due dates, priority, and status.</p></header>{!user ? <section className={uiCardClass}>Demo user not found.</section> : <><section className={uiCardClass}><div className="mb-4 flex items-center justify-between gap-3"><h2 className="text-2xl font-semibold">Recommended Focus List</h2><span className="text-xs text-zinc-500 dark:text-zinc-400">Top {FOCUS_LIMIT}</span></div>{recommendedFocusTasks.length === 0 ? <p className="text-zinc-600 dark:text-zinc-300">No active tasks to recommend right now.</p> : <ul className="space-y-3">{recommendedFocusTasks.map((task) => <li key={task.id} className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"><div className="flex items-start justify-between gap-3"><p className="font-medium">{task.title}</p><span className="rounded-lg bg-zinc-100 px-2 py-1 text-xs dark:bg-zinc-800">{task.urgencyLabel}</span></div><p className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">{task.dueDate ? `Due ${formatDate(task.dueDate)}` : "No due date"} · {task.priority} · {task.status.replace("_", " ")}</p><div className="mt-2"><ProjectBadge project={task.project} /></div></li>)}</ul>}</section><section className="grid gap-6 lg:grid-cols-2"><article className={uiCardClass}><h2 className="mb-3 text-2xl font-semibold">Suggested Today Plan</h2><p className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-200">{planReason}</p><h3 className="mt-4 text-lg font-medium">Today&apos;s Events</h3>{todaysEvents.length === 0 ? <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">No events scheduled today.</p> : <ul className="mt-2 space-y-2">{todaysEvents.map((event) => <li key={event.id} className="rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800"><p className="font-medium">{event.title}</p><p className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">{formatDate(new Date(event.startTime))}</p></li>)}</ul>}<h3 className="mt-5 text-lg font-medium">Suggested Tasks</h3>{suggestedTodayTasks.length === 0 ? <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">No active tasks to schedule today.</p> : <ol className="mt-2 space-y-2">{suggestedTodayTasks.map((task) => <li key={task.id} className="rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800"><p className="font-medium">{task.title}</p><p className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">{task.priority} · {task.status.replace("_", " ")} · {task.urgencyLabel}</p></li>)}</ol>}</article><article className={uiCardClass}><h2 className="mb-3 text-2xl font-semibold">Project Workload</h2>{projectInsights.length === 0 ? <p className="text-zinc-600 dark:text-zinc-300">No projects available yet.</p> : <ul className="space-y-3">{projectInsights.map((project) => <li key={project.id} className={`rounded-xl border p-4 ${project.needsAttention ? "border-amber-300 bg-amber-50/50 dark:border-amber-900/60 dark:bg-amber-950/20" : "border-zinc-200 dark:border-zinc-800"}`}><div className="flex items-start justify-between gap-3"><div><Link href={`/projects/${project.id}`} className="font-medium hover:underline">{project.name}</Link><div className="mt-2"><ProjectBadge project={{ name: project.name, color: project.color }} /></div></div>{project.needsAttention ? <span className="rounded-full bg-amber-100 px-2 py-1 text-xs text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">Needs attention</span> : null}</div><div className="mt-3 grid grid-cols-2 gap-2 text-xs text-zinc-600 dark:text-zinc-300"><p>Active tasks: {project.activeTaskCount}</p><p>Overdue tasks: {project.overdueTaskCount}</p><p>Upcoming events: {project.upcomingEventCount}</p><p>Completed: {project.completionPercent}%</p></div></li>)}</ul>}</article></section></>}</div></main>;
}
