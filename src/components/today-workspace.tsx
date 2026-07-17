"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  uiButtonClass,
  uiCardClass,
  uiPrimaryButtonClass,
} from "@/components/ui";
import { expandRecurringEventsForRange } from "@/lib/recurrence";
import { getLocalDateOnly, getTaskDateBucket } from "@/lib/task-date-buckets";

type TaskStatus = "TODO" | "IN_PROGRESS" | "DONE";
type Priority = "LOW" | "MEDIUM" | "HIGH";
type Recurrence = "NONE" | "DAILY" | "WEEKLY" | "BIWEEKLY" | "MONTHLY";
type Project = { id: string; name: string; color: string | null };
type Task = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: Priority;
  dueDate: string | null;
  recurrence: Recurrence;
  projectId: string | null;
  project: Project | null;
};
type EventItem = {
  id: string;
  sourceEventId?: string;
  title: string;
  startTime: string;
  endTime: string | null;
  recurrence?: Recurrence | null;
  projectId?: string | null;
  project?: Project | null;
};

const dayStart = (date: Date) => getLocalDateOnly(date);
const fmtDate = (value: string) =>
  new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(
    getLocalDateOnly(value),
  );
const fmtTime = (value: string) =>
  new Intl.DateTimeFormat("en-US", { timeStyle: "short" }).format(
    new Date(value),
  );

function ProjectBadge({ project }: { project: Project | null | undefined }) {
  if (!project) return null;
  return (
    <span
      className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs"
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

export function TodayWorkspace({
  initialTasks,
  initialEvents,
}: {
  initialTasks: Task[];
  initialEvents: EventItem[];
}) {
  const [tasks, setTasks] = useState(initialTasks);
  const [events] = useState(initialEvents);
  const [togglingTaskId, setTogglingTaskId] = useState<string | null>(null);

  const { overdueTasks, dueTodayTasks, todayEvents, upcomingEvents } =
    useMemo(() => {
      const today = dayStart(new Date());
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const soonBoundary = new Date(today);
      soonBoundary.setDate(soonBoundary.getDate() + 7);
      const activeTasks = tasks.filter(
        (task) => task.status !== "DONE" && task.dueDate,
      );
      const overdue = activeTasks.filter(
        (task) => getTaskDateBucket(task.dueDate) === "OVERDUE",
      );
      const dueToday = activeTasks.filter(
        (task) => getTaskDateBucket(task.dueDate) === "DUE_TODAY",
      );
      const expanded = expandRecurringEventsForRange(
        events.map((event) => ({ ...event, sourceEventId: event.id })),
        today,
        soonBoundary,
      ).sort(
        (a, b) =>
          new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
      );
      return {
        overdueTasks: overdue,
        dueTodayTasks: dueToday,
        todayEvents: expanded.filter((event) => {
          const start = new Date(event.startTime);
          return start >= today && start < tomorrow;
        }),
        upcomingEvents: expanded.filter((event) => {
          const start = new Date(event.startTime);
          return start >= tomorrow && start <= soonBoundary;
        }),
      };
    }, [tasks, events]);

  async function markDone(task: Task) {
    try {
      setTogglingTaskId(task.id);
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...task,
          status: "DONE",
          dueDate: task.dueDate ?? null,
        }),
      });
      if (!res.ok) throw new Error("Failed to update task");
      setTasks((current) =>
        current.map((item) =>
          item.id === task.id ? { ...item, status: "DONE" } : item,
        ),
      );
    } finally {
      setTogglingTaskId(null);
    }
  }

  const currentDate = new Intl.DateTimeFormat("en-US", {
    dateStyle: "full",
  }).format(new Date());
  const allClear =
    overdueTasks.length === 0 &&
    dueTodayTasks.length === 0 &&
    todayEvents.length === 0;

  return (
    <main className="min-h-screen px-6 py-10">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-4xl font-bold">Today</h1>
            <p className="text-zinc-600 dark:text-zinc-300">{currentDate}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/tasks" className={uiButtonClass}>
              Tasks
            </Link>
            <Link href="/events" className={uiButtonClass}>
              Events
            </Link>
            <Link href="/events/calendar" className={uiButtonClass}>
              Calendar
            </Link>
          </div>
        </header>
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: "Overdue", value: overdueTasks.length },
            { label: "Due Today", value: dueTodayTasks.length },
            { label: "Today's Events", value: todayEvents.length },
            { label: "Upcoming", value: upcomingEvents.length },
          ].map((card) => (
            <article key={card.label} className={uiCardClass}>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                {card.label}
              </p>
              <p className="mt-2 text-3xl font-semibold">{card.value}</p>
            </article>
          ))}
        </section>
        {allClear ? (
          <section className={`${uiCardClass} border-dashed text-center`}>
            <p className="text-lg font-medium">
              You&apos;re all caught up for today.
            </p>
            <p className="mx-auto mt-2 max-w-xl text-sm text-zinc-500 dark:text-zinc-400">
              Add tasks with due dates or create calendar events to build a
              focused daily plan here.
            </p>
          </section>
        ) : null}
        <div className="grid gap-6 lg:grid-cols-2">
          <section className={uiCardClass}>
            <h2 className="text-xl font-semibold">Overdue Tasks</h2>
            {overdueTasks.length === 0 ? (
              <p className="mt-4 rounded-xl border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                No overdue tasks. Tasks that miss their due date will appear
                here.
              </p>
            ) : (
              <ul className="mt-4 space-y-3">
                {overdueTasks.map((task) => (
                  <li
                    key={task.id}
                    className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-700"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium">{task.title}</p>
                        <p className="text-xs text-zinc-600 dark:text-zinc-300">
                          Due {fmtDate(task.dueDate as string)}
                        </p>
                        <div className="mt-2">
                          <ProjectBadge project={task.project} />
                        </div>
                      </div>
                      <button
                        onClick={() => void markDone(task)}
                        disabled={togglingTaskId === task.id}
                        className={uiPrimaryButtonClass}
                      >
                        {togglingTaskId === task.id ? "Saving..." : "Mark done"}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className={uiCardClass}>
            <h2 className="text-xl font-semibold">Due Today</h2>
            {dueTodayTasks.length === 0 ? (
              <p className="mt-4 rounded-xl border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                No tasks due today. Add a due date on the Tasks page to focus
                your day.
              </p>
            ) : (
              <ul className="mt-4 space-y-3">
                {dueTodayTasks.map((task) => (
                  <li
                    key={task.id}
                    className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-700"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium">{task.title}</p>
                        <p className="text-xs text-zinc-600 dark:text-zinc-300">
                          Due {fmtDate(task.dueDate as string)}
                        </p>
                        <div className="mt-2">
                          <ProjectBadge project={task.project} />
                        </div>
                      </div>
                      <button
                        onClick={() => void markDone(task)}
                        disabled={togglingTaskId === task.id}
                        className={uiPrimaryButtonClass}
                      >
                        {togglingTaskId === task.id ? "Saving..." : "Mark done"}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className={uiCardClass}>
            <h2 className="text-xl font-semibold">Today&apos;s Events</h2>
            {todayEvents.length === 0 ? (
              <p className="mt-4 rounded-xl border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                No events scheduled today. Create events from the Events or
                Calendar pages.
              </p>
            ) : (
              <ul className="mt-4 space-y-3">
                {todayEvents.map((event) => (
                  <li
                    key={`${event.sourceEventId ?? event.id}-${event.startTime}`}
                    className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-700"
                  >
                    <p className="font-medium">{event.title}</p>
                    <p className="text-xs text-zinc-600 dark:text-zinc-300">
                      {fmtTime(event.startTime)}
                    </p>
                    <div className="mt-2">
                      <ProjectBadge project={event.project} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className={uiCardClass}>
            <h2 className="text-xl font-semibold">Upcoming Soon</h2>
            {upcomingEvents.length === 0 ? (
              <p className="mt-4 rounded-xl border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                No events in the next week. Upcoming events will show here
                automatically.
              </p>
            ) : (
              <ul className="mt-4 space-y-3">
                {upcomingEvents.map((event) => (
                  <li
                    key={`${event.sourceEventId ?? event.id}-${event.startTime}`}
                    className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-700"
                  >
                    <p className="font-medium">{event.title}</p>
                    <p className="text-xs text-zinc-600 dark:text-zinc-300">
                      {fmtDate(event.startTime)} at {fmtTime(event.startTime)}
                    </p>
                    <div className="mt-2">
                      <ProjectBadge project={event.project} />
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
