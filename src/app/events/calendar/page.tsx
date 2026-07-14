"use client";

import { useRouter } from "next/navigation";
import { BackLink, uiButtonClass, uiCardClass } from "@/components/ui";
import { useEffect, useMemo, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  expandRecurringEventsForRange,
  formatRecurrenceLabel,
  normalizeRecurrence,
} from "@/lib/recurrence";
import { getLocalDateOnly } from "@/lib/task-date-buckets";

type Recurrence = "NONE" | "DAILY" | "WEEKLY" | "BIWEEKLY" | "MONTHLY";

type EventItem = {
  id: string;
  sourceEventId?: string;
  title: string;
  description: string | null;
  location: string | null;
  startTime: string;
  endTime: string | null;
  hasStartTime: boolean;
  hasEndTime: boolean;
  recurrence?: Recurrence | null;
  projectId?: string | null;
  project?: Project | null;
};
type TaskStatus = "TODO" | "IN_PROGRESS" | "DONE";
type Priority = "LOW" | "MEDIUM" | "HIGH";
type TaskItem = {
  id: string;
  title: string;
  description?: string | null;
  status: TaskStatus;
  priority: Priority;
  dueDate: string | null;
  recurrence?: Recurrence | null;
  projectId?: string | null;
  project?: Project | null;
  assignee?: { id: string } | null;
};
type Project = { id: string; name: string; color: string | null };
const ALL_PROJECTS_FILTER = "ALL";
const NO_PROJECT_FILTER = "NO_PROJECT";

function formatDayKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en-US", { timeStyle: "short" }).format(
    new Date(value),
  );
}

export default function EventsCalendarPage() {
  const [events, setEvents] = useState<EventItem[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectFilter, setProjectFilter] = useState(ALL_PROJECTS_FILTER);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState("");
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedDayKey, setSelectedDayKey] = useState(() =>
    formatDayKey(new Date()),
  );
  const [mobileRangeStart, setMobileRangeStart] = useState(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
  });
  const [deletingEventId, setDeletingEventId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [completingTaskId, setCompletingTaskId] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    async function loadEvents() {
      try {
        setFetching(true);
        setError("");

        const [eventsResponse, tasksResponse, projectsData] = await Promise.all(
          [
            fetch("/api/events", { cache: "no-store" }),
            fetch("/api/tasks", { cache: "no-store" }),
            fetch("/api/projects", { cache: "no-store" }).then(async (res) => {
              if (!res.ok) throw new Error("Failed to fetch projects");
              return res.json() as Promise<Project[]>;
            }),
          ],
        );
        if (!eventsResponse.ok || !tasksResponse.ok) {
          throw new Error("Failed to fetch calendar items");
        }

        const [eventsData, tasksData] = await Promise.all([
          eventsResponse.json() as Promise<EventItem[]>,
          tasksResponse.json() as Promise<TaskItem[]>,
        ]);
        setEvents(
          eventsData.map((event) => ({
            ...event,
            recurrence: normalizeRecurrence(event.recurrence),
          })),
        );
        setTasks(tasksData);
        setProjects(projectsData);
      } catch {
        setError("Could not load calendar items.");
      } finally {
        setFetching(false);
      }
    }

    void loadEvents();
  }, []);

  const monthDays = useMemo(() => {
    const monthStart = new Date(month.getFullYear(), month.getMonth(), 1);
    const monthEnd = new Date(month.getFullYear(), month.getMonth() + 1, 0);

    const calendarStart = new Date(monthStart);
    calendarStart.setDate(calendarStart.getDate() - monthStart.getDay());

    const calendarEnd = new Date(monthEnd);
    calendarEnd.setDate(calendarEnd.getDate() + (6 - monthEnd.getDay()));

    const days: Date[] = [];
    const cursor = new Date(calendarStart);

    while (cursor <= calendarEnd) {
      days.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }

    return days;
  }, [month]);

  const visibleRange = useMemo(() => {
    const start = new Date(monthDays[0]);
    start.setHours(0, 0, 0, 0);

    const end = new Date(monthDays[monthDays.length - 1]);
    end.setHours(23, 59, 59, 999);

    return { start, end };
  }, [monthDays]);

  const expandedEvents = useMemo(() => {
    const eventsWithSourceId = events.map((event) => ({
      ...event,
      sourceEventId: event.id,
    }));
    return expandRecurringEventsForRange(
      eventsWithSourceId,
      visibleRange.start,
      visibleRange.end,
    );
  }, [events, visibleRange]);
  const selectedProject = useMemo(
    () => projects.find((project) => project.id === projectFilter) ?? null,
    [projects, projectFilter],
  );
  const filteredExpandedEvents = useMemo(() => {
    return expandedEvents.filter((event) => {
      if (projectFilter === ALL_PROJECTS_FILTER) return true;
      if (projectFilter === NO_PROJECT_FILTER)
        return event.projectId === null || event.projectId === undefined;
      return event.projectId === projectFilter;
    });
  }, [expandedEvents, projectFilter]);

  const eventsByDay = useMemo(() => {
    return filteredExpandedEvents.reduce<Record<string, EventItem[]>>(
      (acc, event) => {
        const key = formatDayKey(new Date(event.startTime));
        if (!acc[key]) {
          acc[key] = [];
        }
        acc[key].push(event);
        return acc;
      },
      {},
    );
  }, [filteredExpandedEvents]);

  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      if (!task.dueDate) return false;
      if (projectFilter === ALL_PROJECTS_FILTER) return true;
      if (projectFilter === NO_PROJECT_FILTER)
        return task.projectId === null || task.projectId === undefined;
      return task.projectId === projectFilter;
    });
  }, [projectFilter, tasks]);

  const tasksByDay = useMemo(() => {
    return filteredTasks.reduce<Record<string, TaskItem[]>>((acc, task) => {
      if (!task.dueDate) return acc;
      const key = formatDayKey(getLocalDateOnly(task.dueDate));
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(task);
      return acc;
    }, {});
  }, [filteredTasks]);

  const selectedDayEvents = useMemo(() => {
    const dayEvents = eventsByDay[selectedDayKey] ?? [];
    return [...dayEvents].sort(
      (a, b) =>
        new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
    );
  }, [eventsByDay, selectedDayKey]);

  const selectedDayTasks = useMemo(
    () => tasksByDay[selectedDayKey] ?? [],
    [selectedDayKey, tasksByDay],
  );

  const mobileDays = useMemo(() => {
    return Array.from({ length: 3 }, (_, index) => {
      const day = new Date(mobileRangeStart);
      day.setDate(day.getDate() + index);
      return day;
    });
  }, [mobileRangeStart]);

  const mobileRangeLabel = useMemo(() => {
    const start = mobileDays[0];
    const end = mobileDays[mobileDays.length - 1];
    const formatter = new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
    });
    return `${formatter.format(start)} – ${formatter.format(end)}`;
  }, [mobileDays]);

  const selectedDayLabel = useMemo(() => {
    const [year, monthNum, day] = selectedDayKey.split("-").map(Number);
    return new Intl.DateTimeFormat("en-US", { dateStyle: "full" }).format(
      new Date(year, monthNum - 1, day),
    );
  }, [selectedDayKey]);

  function openEvent(event: EventItem) {
    router.push(
      `/events?event=${encodeURIComponent(event.sourceEventId ?? event.id)}`,
    );
  }

  async function handleCompleteTask(task: TaskItem) {
    try {
      setCompletingTaskId(task.id);
      setError("");
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: task.title,
          status: "DONE",
          description: task.description ?? "",
          priority: task.priority,
          dueDate: task.dueDate,
          recurrence: normalizeRecurrence(task.recurrence),
          projectId: task.projectId ?? "",
          assigneeId: task.assignee?.id ?? "",
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Failed to complete task");
      }
      const updatedTask = (await res.json()) as TaskItem;
      setTasks((prev) =>
        prev.map((item) => (item.id === task.id ? updatedTask : item)),
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not mark this task done. Please try again.",
      );
    } finally {
      setCompletingTaskId(null);
    }
  }

  async function handleDeleteEvent(eventId: string) {
    try {
      setDeletingEventId(eventId);
      setError("");
      const res = await fetch(`/api/events/${eventId}`, { method: "DELETE" });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Failed to delete event");
      }

      setEvents((prev) => prev.filter((event) => event.id !== eventId));
      setConfirmDeleteId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete event.");
    } finally {
      setDeletingEventId(null);
    }
  }

  return (
    <main className="min-h-screen px-6 py-10">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-4xl font-bold">Full Calendar</h1>
            <p className="mt-2 text-zinc-600 dark:text-zinc-300">
              Explore all events in a larger monthly view with day-by-day
              details.
            </p>
          </div>
          <BackLink href="/events">Back to Events</BackLink>
        </div>

        {error && <p className="mb-6 text-sm text-red-600">{error}</p>}

        <section className={uiCardClass}>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-2xl font-semibold">
              {new Intl.DateTimeFormat("en-US", {
                month: "long",
                year: "numeric",
              }).format(month)}
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={projectFilter}
                onChange={(e) => setProjectFilter(e.target.value)}
                className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              >
                <option value={ALL_PROJECTS_FILTER}>All projects</option>
                <option value={NO_PROJECT_FILTER}>No project</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
              <button
                onClick={() =>
                  setMonth(
                    (prev) =>
                      new Date(prev.getFullYear(), prev.getMonth() - 1, 1),
                  )
                }
                className={uiButtonClass}
              >
                Previous
              </button>
              <button
                onClick={() =>
                  setMonth(
                    (prev) =>
                      new Date(prev.getFullYear(), prev.getMonth() + 1, 1),
                  )
                }
                className={uiButtonClass}
              >
                Next
              </button>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
            <div>
              <div className="mb-4 flex items-center justify-between gap-3 sm:hidden">
                <button
                  type="button"
                  onClick={() =>
                    setMobileRangeStart((prev) => {
                      const next = new Date(prev);
                      next.setDate(next.getDate() - 3);
                      return next;
                    })
                  }
                  className={uiButtonClass}
                >
                  Previous 3 days
                </button>
                <p className="text-center text-sm font-semibold text-zinc-600 dark:text-zinc-300">
                  {mobileRangeLabel}
                </p>
                <button
                  type="button"
                  onClick={() =>
                    setMobileRangeStart((prev) => {
                      const next = new Date(prev);
                      next.setDate(next.getDate() + 3);
                      return next;
                    })
                  }
                  className={uiButtonClass}
                >
                  Next 3 days
                </button>
              </div>

              <div className="grid gap-3 sm:hidden">
                {mobileDays.map((day) => {
                  const dayKey = formatDayKey(day);
                  const isToday = dayKey === formatDayKey(new Date());
                  const isSelected = dayKey === selectedDayKey;
                  const dayEvents = eventsByDay[dayKey] ?? [];
                  const dayTasks = tasksByDay[dayKey] ?? [];
                  const itemCount = dayEvents.length + dayTasks.length;
                  return (
                    <button
                      key={dayKey}
                      type="button"
                      onClick={() => {
                        setSelectedDayKey(dayKey);
                        setMonth(
                          new Date(day.getFullYear(), day.getMonth(), 1),
                        );
                      }}
                      className={`w-full rounded-2xl border p-4 text-left transition ${
                        isSelected
                          ? "border-black bg-zinc-100 dark:bg-zinc-800"
                          : "border-zinc-200 bg-white/80 hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900/60"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                            {new Intl.DateTimeFormat("en-US", {
                              weekday: "long",
                            }).format(day)}
                          </p>
                          <p
                            className={`mt-1 text-2xl font-bold ${isToday ? "text-blue-600 dark:text-blue-300" : ""}`}
                          >
                            {new Intl.DateTimeFormat("en-US", {
                              month: "short",
                              day: "numeric",
                            }).format(day)}
                          </p>
                        </div>
                        <span className="rounded-full bg-zinc-950 px-2.5 py-1 text-xs font-semibold text-white dark:bg-zinc-100 dark:text-zinc-950">
                          {itemCount} {itemCount === 1 ? "item" : "items"}
                        </span>
                      </div>
                      <div className="mt-3 space-y-2">
                        {dayEvents.slice(0, 2).map((event) => (
                          <span
                            key={event.id}
                            className="block truncate rounded-xl bg-zinc-100 px-3 py-2 text-sm text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                          >
                            {event.hasStartTime
                              ? formatTime(event.startTime)
                              : "No time"}{" "}
                            {event.title}
                          </span>
                        ))}
                        {dayTasks
                          .slice(
                            0,
                            Math.max(0, 3 - Math.min(dayEvents.length, 2)),
                          )
                          .map((task) => (
                            <p
                              key={task.id}
                              className={`truncate rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900/70 dark:bg-emerald-950/40 dark:text-emerald-200 ${task.status === "DONE" ? "opacity-60 line-through" : ""}`}
                            >
                              □ {task.title}
                            </p>
                          ))}
                        {itemCount === 0 && (
                          <p className="rounded-xl border border-dashed border-zinc-200 px-3 py-3 text-sm text-zinc-500 dark:border-zinc-700">
                            No items.
                          </p>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="hidden sm:block">
                <div className="mb-3 grid grid-cols-7 gap-2 text-center text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(
                    (day) => (
                      <span key={day}>{day}</span>
                    ),
                  )}
                </div>

                <div className="grid grid-cols-7 gap-2">
                  {monthDays.map((day) => {
                    const dayKey = formatDayKey(day);
                    const isCurrentMonth = day.getMonth() === month.getMonth();
                    const isToday = dayKey === formatDayKey(new Date());
                    const isSelected = dayKey === selectedDayKey;
                    const eventCount = eventsByDay[dayKey]?.length ?? 0;
                    const taskCount = tasksByDay[dayKey]?.length ?? 0;
                    const itemCount = eventCount + taskCount;

                    return (
                      <button
                        key={dayKey}
                        onClick={() => setSelectedDayKey(dayKey)}
                        className={`min-h-28 rounded-xl border p-3 text-left transition ${
                          isSelected
                            ? "border-black bg-zinc-100 dark:bg-zinc-800"
                            : "border-zinc-200 hover:border-zinc-400 dark:border-zinc-700"
                        } ${!isCurrentMonth ? "opacity-45" : ""}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span
                            className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-sm ${
                              isToday
                                ? "bg-blue-600 font-semibold text-white"
                                : ""
                            }`}
                          >
                            {day.getDate()}
                          </span>
                          {itemCount > 0 && (
                            <span className="rounded-full bg-black px-2 py-0.5 text-xs text-white">
                              {itemCount}
                            </span>
                          )}
                        </div>

                        {itemCount > 0 && (
                          <div className="mt-2 space-y-1">
                            {(eventsByDay[dayKey] ?? [])
                              .slice(0, 2)
                              .map((event) => (
                                <span
                                  key={event.id}
                                  className="block truncate rounded border-l-2 bg-zinc-200/70 px-1.5 py-0.5 text-xs text-zinc-800 dark:bg-zinc-700 dark:text-zinc-100"
                                  style={
                                    selectedProject &&
                                    event.projectId === selectedProject.id
                                      ? {
                                          borderLeftColor:
                                            selectedProject.color ?? "#18181b",
                                        }
                                      : undefined
                                  }
                                >
                                  {event.hasStartTime
                                    ? formatTime(event.startTime)
                                    : "No time"}{" "}
                                  {event.title}
                                </span>
                              ))}
                            {(tasksByDay[dayKey] ?? [])
                              .slice(
                                0,
                                Math.max(0, 2 - Math.min(eventCount, 2)),
                              )
                              .map((task) => (
                                <p
                                  key={task.id}
                                  className={`truncate rounded border-l-2 border-emerald-500 bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200 ${task.status === "DONE" ? "opacity-60 line-through" : ""}`}
                                >
                                  Task · {task.title}
                                </p>
                              ))}
                            {itemCount > 2 && (
                              <p className="text-xs text-zinc-500">
                                +{itemCount - 2} more
                              </p>
                            )}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <aside className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-700">
              <h3 className="text-lg font-semibold">{selectedDayLabel}</h3>
              <p className="mt-1 text-sm text-zinc-500">
                {selectedDayEvents.length + selectedDayTasks.length === 0
                  ? "No events or tasks planned for this day."
                  : `${selectedDayEvents.length + selectedDayTasks.length} item${selectedDayEvents.length + selectedDayTasks.length > 1 ? "s" : ""} scheduled`}
              </p>

              <div className="mt-4 space-y-3">
                {selectedDayEvents.map((event) => (
                  <article
                    key={event.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => openEvent(event)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") openEvent(event);
                    }}
                    className="cursor-pointer rounded-lg border border-zinc-200 p-3 transition hover:border-blue-300 hover:bg-blue-50/50 dark:border-zinc-700 dark:hover:border-blue-800 dark:hover:bg-blue-950/20"
                    style={
                      selectedProject && event.projectId === selectedProject.id
                        ? {
                            borderLeftWidth: 4,
                            borderLeftColor: selectedProject.color ?? "#18181b",
                          }
                        : undefined
                    }
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="font-medium">{event.title}</p>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDeleteId(event.sourceEventId ?? event.id);
                        }}
                        disabled={
                          deletingEventId === (event.sourceEventId ?? event.id)
                        }
                        className="inline-flex shrink-0 items-center rounded-md bg-red-600 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {deletingEventId === (event.sourceEventId ?? event.id)
                          ? "Deleting..."
                          : "Delete"}
                      </button>
                    </div>
                    <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                      {event.hasStartTime
                        ? formatTime(event.startTime)
                        : "Time not specified"}
                      {event.endTime && event.hasEndTime
                        ? ` - ${formatTime(event.endTime)}`
                        : ""}
                    </p>
                    {event.location && (
                      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                        {event.location}
                      </p>
                    )}
                    <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                      Repeats: {formatRecurrenceLabel(event.recurrence)}
                    </p>
                    {event.description && (
                      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                        {event.description}
                      </p>
                    )}
                  </article>
                ))}

                {selectedDayTasks.map((task) => (
                  <article
                    key={task.id}
                    className={`rounded-lg border border-emerald-200 bg-emerald-50/70 p-3 transition dark:border-emerald-900/70 dark:bg-emerald-950/30 ${task.status === "DONE" ? "opacity-65" : ""}`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p
                        className={`font-medium ${task.status === "DONE" ? "line-through" : ""}`}
                      >
                        {task.title}
                      </p>
                      {task.status === "DONE" ? (
                        <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-xs font-semibold text-white">
                          Task
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleCompleteTask(task);
                          }}
                          disabled={completingTaskId === task.id}
                          className="rounded-full bg-emerald-600 px-3 py-1 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {completingTaskId === task.id ? "Saving…" : "Done"}
                        </button>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-emerald-800 dark:text-emerald-200">
                      Status: {task.status.replace("_", " ")} · Priority:{" "}
                      {task.priority}
                    </p>
                    {task.dueDate && (
                      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                        Due{" "}
                        {getLocalDateOnly(task.dueDate).toLocaleDateString()}
                      </p>
                    )}
                  </article>
                ))}

                {!fetching &&
                  selectedDayEvents.length === 0 &&
                  selectedDayTasks.length === 0 && (
                    <p className="rounded-lg border border-dashed border-zinc-200 px-3 py-4 text-sm text-zinc-500 dark:border-zinc-700">
                      Select another day or create an event or due task.
                    </p>
                  )}

                {fetching && (
                  <p className="text-sm text-zinc-500">
                    Loading calendar items...
                  </p>
                )}
              </div>
            </aside>
          </div>
        </section>
      </div>
      <ConfirmDialog
        open={confirmDeleteId !== null}
        title="Delete event?"
        message="This will move the event to Trash. You can restore it later from the Trash page."
        confirmLabel="Move to Trash"
        loading={deletingEventId !== null}
        onCancel={() => {
          if (deletingEventId) return;
          setConfirmDeleteId(null);
        }}
        onConfirm={() => {
          if (!confirmDeleteId) return;
          void handleDeleteEvent(confirmDeleteId);
        }}
      />
    </main>
  );
}
