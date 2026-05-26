"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { expandRecurringEventsForRange, formatRecurrenceLabel, normalizeRecurrence } from "@/lib/recurrence";
import { uiButtonClass, uiCardClass } from "@/components/ui";

type TaskStatus = "TODO" | "IN_PROGRESS" | "DONE";
type TaskPriority = "LOW" | "MEDIUM" | "HIGH";
type Recurrence = "NONE" | "DAILY" | "WEEKLY" | "BIWEEKLY" | "MONTHLY";
type Project = { id: string; name: string; color: string | null };
type Task = {
  id: string;
  title: string;
  dueDate: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  recurrence: Recurrence;
  projectId: string | null;
  project: Project | null;
};
type EventItem = {
  id: string;
  sourceEventId?: string;
  title: string;
  startTime: string;
  recurrence?: Recurrence | null;
  projectId?: string | null;
  project?: Project | null;
};

type RoadmapTypeFilter = "ALL" | "TASKS" | "EVENTS";
type RoadmapProjectFilter = "ALL" | "NONE" | string;
type RoadmapBucket = "OVERDUE" | "TODAY" | "THIS_WEEK" | "NEXT_WEEK" | "LATER";
type RoadmapItem = {
  id: string;
  kind: "TASK" | "EVENT";
  title: string;
  when: string;
  timeMs: number;
  taskStatus?: TaskStatus;
  taskPriority?: TaskPriority;
  recurrence?: Recurrence | null;
  project: Project | null;
  taskId?: string;
  eventId?: string;
};

function getLocalDayStart(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function getDayDiffFromToday(value: string, todayStart: Date) {
  const date = getLocalDayStart(new Date(value));
  return Math.floor((date.getTime() - todayStart.getTime()) / 86400000);
}

function getRoadmapBucket(value: string, kind: "TASK" | "EVENT"): RoadmapBucket {
  const todayStart = getLocalDayStart(new Date());
  const dayDiff = getDayDiffFromToday(value, todayStart);
  if (dayDiff < 0) return "OVERDUE";
  if (dayDiff === 0) return "TODAY";
  if (dayDiff <= 6) return "THIS_WEEK";
  if (dayDiff <= 13) return "NEXT_WEEK";
  if (kind === "EVENT" || dayDiff > 13) return "LATER";
  return "LATER";
}

function formatDateLabel(value: string) {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export default function RoadmapPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectFilter, setProjectFilter] = useState<RoadmapProjectFilter>("ALL");
  const [typeFilter, setTypeFilter] = useState<RoadmapTypeFilter>("ALL");
  const [loading, setLoading] = useState(true);
  const [updatingTaskId, setUpdatingTaskId] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function fetchData(showLoading = true) {
    try {
      if (showLoading) setLoading(true);
      setError("");
      const [tasksRes, eventsRes, projectsRes] = await Promise.all([
        fetch("/api/tasks"),
        fetch("/api/events"),
        fetch("/api/projects"),
      ]);
      if (!tasksRes.ok || !eventsRes.ok || !projectsRes.ok) {
        throw new Error("Failed to fetch roadmap data");
      }

      const tasksData = (await tasksRes.json()) as Task[];
      const eventsData = (await eventsRes.json()) as EventItem[];
      const projectsData = (await projectsRes.json()) as Project[];

      setTasks(tasksData);
      setEvents(eventsData.map((event) => ({ ...event, recurrence: normalizeRecurrence(event.recurrence) })));
      setProjects(projectsData);
    } catch {
      setError("Could not load roadmap.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchData();
    }, 0);

    return () => clearTimeout(timer);
  }, []);

  const expandedEvents = useMemo(() => {
    const now = new Date();
    const rangeStart = new Date(now);
    rangeStart.setDate(rangeStart.getDate() - 14);
    rangeStart.setHours(0, 0, 0, 0);
    const rangeEnd = new Date(now);
    rangeEnd.setDate(rangeEnd.getDate() + 60);
    rangeEnd.setHours(23, 59, 59, 999);

    return expandRecurringEventsForRange(
      events.map((event) => ({ ...event, sourceEventId: event.id })),
      rangeStart,
      rangeEnd
    );
  }, [events]);

  const activeTaskItems = useMemo(() => {
    return tasks
      .filter((task) => task.status !== "DONE" && task.dueDate)
      .map<RoadmapItem>((task) => ({
        id: `task-${task.id}`,
        kind: "TASK",
        title: task.title,
        when: task.dueDate as string,
        timeMs: new Date(task.dueDate as string).getTime(),
        taskStatus: task.status,
        taskPriority: task.priority,
        recurrence: task.recurrence,
        project: task.project,
        taskId: task.id,
      }));
  }, [tasks]);

  const eventItems = useMemo(() => {
    return expandedEvents.map<RoadmapItem>((event) => ({
      id: `event-${event.id}`,
      kind: "EVENT",
      title: event.title,
      when: event.startTime,
      timeMs: new Date(event.startTime).getTime(),
      recurrence: event.recurrence,
      project: event.project ?? null,
      eventId: event.sourceEventId ?? event.id,
    }));
  }, [expandedEvents]);

  const combinedItems = useMemo(() => {
    return [...activeTaskItems, ...eventItems]
      .filter((item) => {
        if (typeFilter === "TASKS") return item.kind === "TASK";
        if (typeFilter === "EVENTS") return item.kind === "EVENT";
        return true;
      })
      .filter((item) => {
        if (projectFilter === "ALL") return true;
        if (projectFilter === "NONE") return !item.project;
        return item.project?.id === projectFilter;
      })
      .sort((a, b) => a.timeMs - b.timeMs);
  }, [activeTaskItems, eventItems, typeFilter, projectFilter]);

  const sectionedItems = useMemo(() => {
    const sections: Record<RoadmapBucket, RoadmapItem[]> = {
      OVERDUE: [], TODAY: [], THIS_WEEK: [], NEXT_WEEK: [], LATER: [],
    };

    combinedItems.forEach((item) => {
      const bucket = getRoadmapBucket(item.when, item.kind);
      sections[bucket].push(item);
    });

    return sections;
  }, [combinedItems]);

  const summary = useMemo(() => {
    const overdue = sectionedItems.OVERDUE.length;
    const today = sectionedItems.TODAY.length;
    const thisWeek = sectionedItems.THIS_WEEK.length;
    const upcomingEvents = eventItems.filter((item) => new Date(item.when) >= getLocalDayStart(new Date())).length;
    return { overdue, today, thisWeek, upcomingEvents };
  }, [sectionedItems, eventItems]);

  async function markTaskDone(taskId: string) {
    try {
      setUpdatingTaskId(taskId);
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "DONE" }),
      });
      if (!res.ok) throw new Error("Failed to update task");
      await fetchData(false);
    } finally {
      setUpdatingTaskId(null);
    }
  }

  const sections: Array<{ key: RoadmapBucket; title: string; items: RoadmapItem[] }> = [
    { key: "OVERDUE", title: "Overdue", items: sectionedItems.OVERDUE },
    { key: "TODAY", title: "Today", items: sectionedItems.TODAY },
    { key: "THIS_WEEK", title: "This Week", items: sectionedItems.THIS_WEEK },
    { key: "NEXT_WEEK", title: "Next Week", items: sectionedItems.NEXT_WEEK },
    { key: "LATER", title: "Later", items: sectionedItems.LATER },
  ];

  return <main className="min-h-screen px-6 py-10"><div className="mx-auto max-w-6xl space-y-8">
    <header>
      <h1 className="text-4xl font-bold">Roadmap</h1>
      <p className="mt-2 text-zinc-600 dark:text-zinc-300">Plan upcoming tasks and events across projects.</p>
    </header>

    <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <article className={uiCardClass}><p className="text-sm text-zinc-500">Overdue items</p><p className="mt-2 text-3xl font-bold text-red-600">{summary.overdue}</p></article>
      <article className={uiCardClass}><p className="text-sm text-zinc-500">Due today</p><p className="mt-2 text-3xl font-bold">{summary.today}</p></article>
      <article className={uiCardClass}><p className="text-sm text-zinc-500">This week</p><p className="mt-2 text-3xl font-bold">{summary.thisWeek}</p></article>
      <article className={uiCardClass}><p className="text-sm text-zinc-500">Upcoming events</p><p className="mt-2 text-3xl font-bold">{summary.upcomingEvents}</p></article>
    </section>

    <section className={`${uiCardClass} flex flex-col gap-4 md:flex-row md:items-center`}>
      <label className="flex items-center gap-2 text-sm">Project
        <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} className="rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900">
          <option value="ALL">All projects</option>
          <option value="NONE">No project</option>
          {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm">Type
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as RoadmapTypeFilter)} className="rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900">
          <option value="ALL">All</option><option value="TASKS">Tasks</option><option value="EVENTS">Events</option>
        </select>
      </label>
    </section>

    {loading ? <p>Loading roadmap...</p> : (
      <section className="space-y-6">
        {sections.map((section) => (
          <article key={section.key} className={uiCardClass}>
            <div className="mb-4 flex items-center justify-between"><h2 className="text-xl font-semibold">{section.title}</h2><span className="text-sm text-zinc-500">{section.items.length} items</span></div>
            {section.items.length === 0 ? <p className="text-sm text-zinc-500">Nothing here yet.</p> : (
              <div className="space-y-3">{section.items.map((item) => (
                <div key={item.id} className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-700">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-medium">{item.title}</p>
                      <p className="text-sm text-zinc-600 dark:text-zinc-300">{formatDateLabel(item.when)}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className={`rounded-full px-2 py-1 ${item.kind === "TASK" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-200" : "bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-200"}`}>{item.kind === "TASK" ? "Task" : "Event"}</span>
                      {item.taskPriority && <span className="rounded-full bg-zinc-100 px-2 py-1 dark:bg-zinc-800">Priority: {item.taskPriority}</span>}
                      {item.taskStatus && <span className="rounded-full bg-zinc-100 px-2 py-1 dark:bg-zinc-800">Status: {item.taskStatus.replace("_", " ")}</span>}
                      {item.kind === "EVENT" && item.recurrence && item.recurrence !== "NONE" && <span className="rounded-full bg-amber-100 px-2 py-1 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200">Repeats {formatRecurrenceLabel(item.recurrence)}</span>}
                      {item.project ? <span className="rounded-full border px-2 py-1" style={{ borderColor: item.project.color ?? undefined }}>{item.project.name}</span> : <span className="rounded-full border border-zinc-300 px-2 py-1 text-zinc-500 dark:border-zinc-700">No project</span>}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {item.kind === "TASK" && item.taskId ? <>
                      <Link href="/tasks" className={uiButtonClass}>Open Tasks</Link>
                      <button onClick={() => void markTaskDone(item.taskId as string)} disabled={updatingTaskId === item.taskId} className={uiButtonClass}>{updatingTaskId === item.taskId ? "Marking..." : "Mark Done"}</button>
                    </> : <Link href="/events" className={uiButtonClass}>Open Events</Link>}
                    {item.project && <Link href={`/projects/${item.project.id}`} className={uiButtonClass}>Open Project</Link>}
                  </div>
                </div>
              ))}</div>
            )}
          </article>
        ))}
      </section>
    )}
    {error && <p className="text-sm text-red-600">{error}</p>}
  </div></main>;
}
