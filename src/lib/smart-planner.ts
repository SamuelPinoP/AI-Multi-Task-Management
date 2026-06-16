import "server-only";

import { Priority, ProjectStatus, Recurrence, TaskStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { projectAccessWhere } from "@/lib/project-access";
import { expandRecurringEventsForRange, normalizeRecurrence } from "@/lib/recurrence";

export type PlannerPriority = "HIGH" | "MEDIUM" | "LOW";
export type PlannerSuggestionKind = "TASK" | "EVENT" | "PROJECT" | "NOTE" | "ACTIVITY" | "SYNTHETIC";
export type PlannerSectionKey = "urgent" | "dueToday" | "upcoming" | "suggestedFocus" | "projectFollowUp";

export type PlannerSuggestion = {
  id: string;
  title: string;
  reason: string;
  priority: PlannerPriority;
  kind: PlannerSuggestionKind;
  related?: { type: PlannerSuggestionKind; id: string; label: string };
  actionHref?: string;
  projectId?: string | null;
  canCreateTask: boolean;
  suggestedTaskTitle?: string;
  suggestedTaskDescription?: string;
};

export type PlannerSection = {
  key: PlannerSectionKey;
  title: string;
  description: string;
  suggestions: PlannerSuggestion[];
};

export type SmartPlanner = {
  generatedAt: Date;
  stats: {
    overdueTasks: number;
    dueTodayTasks: number;
    dueSoonTasks: number;
    upcomingEvents: number;
    activeProjects: number;
    recentNotes: number;
  };
  sections: PlannerSection[];
};

const DAY_MS = 86_400_000;

function dayStart(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function dayDiff(target: Date, now: Date) {
  return Math.floor((dayStart(target).getTime() - dayStart(now).getTime()) / DAY_MS);
}

function priorityFromTask(priority: Priority, overdue = false): PlannerPriority {
  if (overdue || priority === Priority.HIGH) return "HIGH";
  if (priority === Priority.MEDIUM) return "MEDIUM";
  return "LOW";
}

function taskHref(id: string) {
  return `/tasks?highlight=${encodeURIComponent(id)}`;
}

function eventHref(id: string) {
  return `/events?highlight=${encodeURIComponent(id)}`;
}

function projectHref(id: string) {
  return `/projects/${id}`;
}

export async function generateSmartPlanner(userId: string, now = new Date()): Promise<SmartPlanner> {
  const todayStart = dayStart(now);
  const soonEnd = addDays(todayStart, 8);
  const recentStart = addDays(now, -7);

  const accessibleProjectWhere = projectAccessWhere(userId);

  const [tasks, events, projects, notes, comments] = await Promise.all([
    prisma.task.findMany({
      where: { deletedAt: null, status: { not: TaskStatus.DONE }, OR: [{ userId }, { project: accessibleProjectWhere }] },
      include: { project: { select: { id: true, name: true, color: true } } },
      orderBy: [{ dueDate: "asc" }, { priority: "desc" }, { updatedAt: "desc" }],
      take: 80,
    }),
    prisma.event.findMany({
      where: { deletedAt: null, startTime: { lte: soonEnd }, OR: [{ userId }, { project: accessibleProjectWhere }] },
      include: { project: { select: { id: true, name: true } } },
      orderBy: { startTime: "asc" },
      take: 80,
    }),
    prisma.project.findMany({
      where: { AND: [accessibleProjectWhere, { status: ProjectStatus.ACTIVE }] },
      select: { id: true, name: true, updatedAt: true, tasks: { where: { deletedAt: null }, select: { id: true, status: true, dueDate: true } }, events: { where: { deletedAt: null, startTime: { gte: todayStart, lte: soonEnd } }, select: { id: true } } },
      orderBy: { updatedAt: "desc" },
      take: 40,
    }),
    prisma.note.findMany({
      where: { deletedAt: null, updatedAt: { gte: recentStart }, OR: [{ userId }, { project: accessibleProjectWhere }] },
      include: { project: { select: { id: true, name: true } } },
      orderBy: { updatedAt: "desc" },
      take: 12,
    }),
    prisma.projectComment.findMany({
      where: { createdAt: { gte: recentStart }, project: accessibleProjectWhere },
      include: { project: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
      take: 12,
    }),
  ]);

  const urgent: PlannerSuggestion[] = [];
  const dueToday: PlannerSuggestion[] = [];
  const upcoming: PlannerSuggestion[] = [];
  const suggestedFocus: PlannerSuggestion[] = [];
  const projectFollowUp: PlannerSuggestion[] = [];

  for (const task of tasks) {
    const diff = task.dueDate ? dayDiff(task.dueDate, now) : null;
    const suggestion: PlannerSuggestion = {
      id: `task-${task.id}`,
      title: task.title,
      reason: diff === null ? `Active ${task.priority.toLowerCase()} priority task${task.project ? ` in ${task.project.name}` : ""}.` : diff < 0 ? `Overdue by ${Math.abs(diff)} day${Math.abs(diff) === 1 ? "" : "s"}.` : diff === 0 ? "Due today; schedule it before flexible work." : `Due in ${diff} day${diff === 1 ? "" : "s"}.`,
      priority: priorityFromTask(task.priority, diff !== null && diff < 0),
      kind: "TASK",
      related: { type: "TASK", id: task.id, label: task.project ? `${task.project.name} task` : "Task" },
      actionHref: taskHref(task.id),
      projectId: task.project?.id ?? null,
      canCreateTask: false,
    };
    if (diff !== null && diff < 0) urgent.push(suggestion);
    else if (diff === 0) dueToday.push(suggestion);
    else if (diff !== null && diff <= 7) upcoming.push(suggestion);
    suggestedFocus.push(suggestion);
  }

  const eventOccurrences = expandRecurringEventsForRange(events.map((event) => ({ ...event, startTime: event.startTime.toISOString(), endTime: event.endTime?.toISOString() ?? null, recurrence: normalizeRecurrence(event.recurrence ?? Recurrence.NONE) })), todayStart, soonEnd);
  for (const event of eventOccurrences.slice(0, 10)) {
    const starts = new Date(event.startTime);
    const diff = dayDiff(starts, now);
    upcoming.push({ id: `event-${event.id}-${starts.toISOString()}`, title: event.title, reason: diff === 0 ? "Happening today; protect time around this event." : `Upcoming event in ${diff} day${diff === 1 ? "" : "s"}.`, priority: diff === 0 ? "HIGH" : "MEDIUM", kind: "EVENT", related: { type: "EVENT", id: event.id, label: "Event" }, actionHref: eventHref(event.id), canCreateTask: true, suggestedTaskTitle: `Prepare for ${event.title}`, suggestedTaskDescription: "Created from Smart Planner event preparation suggestion." });
  }

  for (const project of projects) {
    const openTasks = project.tasks.filter((task) => task.status !== TaskStatus.DONE);
    const overdue = openTasks.filter((task) => task.dueDate && dayDiff(task.dueDate, now) < 0);
    const stale = project.updatedAt < addDays(now, -5);
    if (overdue.length || openTasks.length >= 4 || stale || project.events.length) {
      projectFollowUp.push({ id: `project-${project.id}`, title: `Review ${project.name}`, reason: overdue.length ? `${overdue.length} overdue project task${overdue.length === 1 ? "" : "s"} need follow-up.` : stale ? "Active project has not changed in several days." : `${openTasks.length} open task${openTasks.length === 1 ? "" : "s"} and ${project.events.length} upcoming event${project.events.length === 1 ? "" : "s"}.`, priority: overdue.length ? "HIGH" : "MEDIUM", kind: "PROJECT", related: { type: "PROJECT", id: project.id, label: project.name }, actionHref: projectHref(project.id), projectId: project.id, canCreateTask: true, suggestedTaskTitle: `Follow up on ${project.name}`, suggestedTaskDescription: "Created from Smart Planner project follow-up suggestion." });
    }
  }

  for (const note of notes.slice(0, 5)) {
    suggestedFocus.push({ id: `note-${note.id}`, title: `Turn note into action: ${note.title}`, reason: "Recently updated note may contain decisions or next steps worth converting into work.", priority: "LOW", kind: "NOTE", related: { type: "NOTE", id: note.id, label: note.project?.name ?? "Recent note" }, actionHref: `/notes?highlight=${encodeURIComponent(note.id)}`, projectId: note.project?.id ?? null, canCreateTask: true, suggestedTaskTitle: `Action from note: ${note.title}`, suggestedTaskDescription: "Created from Smart Planner recent-note suggestion." });
  }

  for (const comment of comments.slice(0, 4)) {
    projectFollowUp.push({ id: `comment-${comment.id}`, title: `Respond or act on ${comment.project.name} discussion`, reason: "Recent project chat activity may need an owner, reply, or next step.", priority: "MEDIUM", kind: "ACTIVITY", related: { type: "PROJECT", id: comment.project.id, label: comment.project.name }, actionHref: `/projects/${comment.project.id}/chat`, projectId: comment.project.id, canCreateTask: true, suggestedTaskTitle: `Follow up on ${comment.project.name} discussion`, suggestedTaskDescription: "Created from Smart Planner project-chat suggestion." });
  }

  const limit = (items: PlannerSuggestion[], count: number) => items.slice(0, count);
  return {
    generatedAt: now,
    stats: { overdueTasks: urgent.length, dueTodayTasks: dueToday.length, dueSoonTasks: upcoming.filter((item) => item.kind === "TASK").length, upcomingEvents: eventOccurrences.length, activeProjects: projects.length, recentNotes: notes.length },
    sections: [
      { key: "urgent", title: "Urgent", description: "Overdue and highest-risk work to clear first.", suggestions: limit(urgent, 6) },
      { key: "dueToday", title: "Due Today", description: "Commitments that should be scheduled into today.", suggestions: limit(dueToday, 6) },
      { key: "upcoming", title: "Upcoming", description: "Near-term tasks and events to prepare for.", suggestions: limit(upcoming, 8) },
      { key: "suggestedFocus", title: "Suggested Focus", description: "The best deterministic focus list based on due dates, priority, notes, and status.", suggestions: limit(suggestedFocus.sort((a, b) => ["HIGH", "MEDIUM", "LOW"].indexOf(a.priority) - ["HIGH", "MEDIUM", "LOW"].indexOf(b.priority)), 8) },
      { key: "projectFollowUp", title: "Project Follow-Up", description: "Shared project work, comments, stale projects, and workload signals.", suggestions: limit(projectFollowUp, 8) },
    ],
  };
}
