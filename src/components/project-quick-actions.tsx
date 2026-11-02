"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { notifyWorkspaceChanged } from "@/lib/workspace-events";

type QuickAction = "NOTE" | "TASK" | "EVENT";
type TaskStatus = "TODO" | "IN_PROGRESS" | "DONE";
type Priority = "LOW" | "MEDIUM" | "HIGH";
type Recurrence = "NONE" | "DAILY" | "WEEKLY" | "BIWEEKLY" | "MONTHLY";

/** Two fields to a row from 380px; narrower, a date or "In progress" is cut off beside another field. */
const quickFormGridClass = "mt-4 grid grid-cols-1 gap-3 min-[380px]:grid-cols-2";
/** A field with its name above it; the control keeps the form's normal text. */
const quickFieldLabelClass = "grid min-w-0 gap-1.5 text-sm font-medium";
const quickFieldClass =
  "w-full min-w-0 rounded-xl border border-zinc-300 px-3 py-2 text-base font-normal dark:border-zinc-700";

export function ProjectQuickActions({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [activeAction, setActiveAction] = useState<QuickAction | null>(null);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [noteTitle, setNoteTitle] = useState("");
  const [noteContent, setNoteContent] = useState("");

  const [taskTitle, setTaskTitle] = useState("");
  const [taskDescription, setTaskDescription] = useState("");
  const [taskPriority, setTaskPriority] = useState<Priority>("MEDIUM");
  const [taskStatus, setTaskStatus] = useState<TaskStatus>("TODO");
  const [taskDueDate, setTaskDueDate] = useState("");

  const [eventTitle, setEventTitle] = useState("");
  const [eventDescription, setEventDescription] = useState("");
  const [eventLocation, setEventLocation] = useState("");
  const [eventStartDate, setEventStartDate] = useState("");
  const [eventStartTime, setEventStartTime] = useState("");
  const [eventEndDate, setEventEndDate] = useState("");
  const [eventEndTime, setEventEndTime] = useState("");
  const [eventRecurrence, setEventRecurrence] = useState<Recurrence>("NONE");

  async function submitToApi(path: string, payload: Record<string, unknown>) {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error(data?.error || "Failed to create item");
    }
  }

  function resetAndRefresh() {
    setError("");
    setActiveAction(null);
    notifyWorkspaceChanged();
    router.refresh();
  }

  async function handleAddNote(e: FormEvent) {
    e.preventDefault();
    if (!noteTitle.trim() && !noteContent.trim()) {
      setError("Add a note title or content before saving.");
      return;
    }

    try {
      setIsSubmitting(true);
      setError("");
      await submitToApi("/api/notes", {
        title: noteTitle,
        content: noteContent,
        projectId,
      });
      setNoteTitle("");
      setNoteContent("");
      resetAndRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create note.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleAddTask(e: FormEvent) {
    e.preventDefault();
    if (!taskTitle.trim()) {
      setError("Task title is required.");
      return;
    }

    try {
      setIsSubmitting(true);
      setError("");
      await submitToApi("/api/tasks", {
        title: taskTitle,
        description: taskDescription,
        priority: taskPriority,
        status: taskStatus,
        dueDate: taskDueDate || null,
        projectId,
      });
      setTaskTitle("");
      setTaskDescription("");
      setTaskPriority("MEDIUM");
      setTaskStatus("TODO");
      setTaskDueDate("");
      resetAndRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create task.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleAddEvent(e: FormEvent) {
    e.preventDefault();
    if (!eventTitle.trim()) {
      setError("Event title is required.");
      return;
    }
    if (!eventStartDate) {
      setError("Start date is required.");
      return;
    }

    try {
      setIsSubmitting(true);
      setError("");
      await submitToApi("/api/events", {
        title: eventTitle,
        description: eventDescription,
        location: eventLocation,
        startDate: eventStartDate,
        startTime: eventStartTime || null,
        endDate: eventEndDate || null,
        endTime: eventEndTime || null,
        recurrence: eventRecurrence,
        projectId,
      });
      setEventTitle("");
      setEventDescription("");
      setEventLocation("");
      setEventStartDate("");
      setEventStartTime("");
      setEventEndDate("");
      setEventEndTime("");
      setEventRecurrence("NONE");
      resetAndRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create event.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="mt-8 rounded-2xl border border-zinc-200 p-6 shadow-sm dark:border-zinc-800">
      <h2 className="text-2xl font-semibold">Quick Actions</h2>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
        Create items directly in this project workspace.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setActiveAction("NOTE")}
          className="rounded-xl border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          Add Note
        </button>
        <button
          type="button"
          onClick={() => setActiveAction("TASK")}
          className="rounded-xl border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          Add Task
        </button>
        <button
          type="button"
          onClick={() => setActiveAction("EVENT")}
          className="rounded-xl border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          Add Event
        </button>
      </div>

      {error ? (
        <p className="mt-4 rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </p>
      ) : null}

      {activeAction === "NOTE" ? (
        <form onSubmit={handleAddNote} className="mt-4 space-y-3">
          <input
            value={noteTitle}
            onChange={(e) => setNoteTitle(e.target.value)}
            placeholder="Note title (optional)"
            className="w-full rounded-xl border border-zinc-300 px-4 py-2 outline-none focus:border-black dark:border-zinc-700"
          />
          <textarea
            value={noteContent}
            onChange={(e) => setNoteContent(e.target.value)}
            placeholder="Content (optional)"
            rows={4}
            className="w-full rounded-xl border border-zinc-300 px-4 py-2 outline-none focus:border-black dark:border-zinc-700"
          />
          <button
            disabled={isSubmitting}
            className="rounded-xl px-4 py-2 text-sm bg-accent font-medium text-accent-ink transition-colors hover:bg-accent-hover disabled:opacity-60"
          >
            {isSubmitting ? "Saving..." : "Create note"}
          </button>
        </form>
      ) : null}

      {activeAction === "TASK" ? (
        <form
          onSubmit={handleAddTask}
          className={quickFormGridClass}
        >
          <input
            value={taskTitle}
            onChange={(e) => setTaskTitle(e.target.value)}
            placeholder="Task title"
            className="col-span-full rounded-xl border border-zinc-300 px-4 py-2 outline-none focus:border-black dark:border-zinc-700"
          />
          <textarea
            value={taskDescription}
            onChange={(e) => setTaskDescription(e.target.value)}
            placeholder="Description (optional)"
            rows={3}
            className="col-span-full rounded-xl border border-zinc-300 px-4 py-2 outline-none focus:border-black dark:border-zinc-700"
          />
          {/* Date fields show no placeholder (a blank box on Android), so every field gets a visible label. */}
          <label className={quickFieldLabelClass}>
            Priority
            <select
              value={taskPriority}
              onChange={(e) => setTaskPriority(e.target.value as Priority)}
              className={quickFieldClass}
            >
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
            </select>
          </label>
          <label className={quickFieldLabelClass}>
            Status
            <select
              value={taskStatus}
              onChange={(e) => setTaskStatus(e.target.value as TaskStatus)}
              className={quickFieldClass}
            >
              <option value="TODO">To do</option>
              <option value="IN_PROGRESS">In progress</option>
              <option value="DONE">Done</option>
            </select>
          </label>
          <label className={`${quickFieldLabelClass} col-span-full`}>
            Due date
            <input
              type="date"
              value={taskDueDate}
              onChange={(e) => setTaskDueDate(e.target.value)}
              className={quickFieldClass}
            />
          </label>
          <button
            disabled={isSubmitting}
            className="col-span-full rounded-xl px-4 py-2 text-sm bg-accent font-medium text-accent-ink transition-colors hover:bg-accent-hover disabled:opacity-60"
          >
            {isSubmitting ? "Saving..." : "Create task"}
          </button>
        </form>
      ) : null}

      {activeAction === "EVENT" ? (
        <form
          onSubmit={handleAddEvent}
          className={quickFormGridClass}
        >
          <input
            value={eventTitle}
            onChange={(e) => setEventTitle(e.target.value)}
            placeholder="Event title"
            className="col-span-full rounded-xl border border-zinc-300 px-4 py-2 outline-none focus:border-black dark:border-zinc-700"
          />
          <textarea
            value={eventDescription}
            onChange={(e) => setEventDescription(e.target.value)}
            placeholder="Description (optional)"
            rows={3}
            className="col-span-full rounded-xl border border-zinc-300 px-4 py-2 outline-none focus:border-black dark:border-zinc-700"
          />
          <input
            value={eventLocation}
            onChange={(e) => setEventLocation(e.target.value)}
            placeholder="Location (optional)"
            className="col-span-full rounded-xl border border-zinc-300 px-4 py-2 dark:border-zinc-700"
          />
          {/* The same labels as the New event sheet. */}
          <label className={quickFieldLabelClass}>
            Starts
            <input
              type="date"
              value={eventStartDate}
              onChange={(e) => setEventStartDate(e.target.value)}
              className={quickFieldClass}
            />
          </label>
          <label className={quickFieldLabelClass}>
            Start time
            <input
              type="time"
              value={eventStartTime}
              onChange={(e) => setEventStartTime(e.target.value)}
              className={quickFieldClass}
            />
          </label>
          <label className={quickFieldLabelClass}>
            Ends
            <input
              type="date"
              value={eventEndDate}
              onChange={(e) => setEventEndDate(e.target.value)}
              className={quickFieldClass}
            />
          </label>
          <label className={quickFieldLabelClass}>
            End time
            <input
              type="time"
              value={eventEndTime}
              onChange={(e) => setEventEndTime(e.target.value)}
              className={quickFieldClass}
            />
          </label>
          <label className={`${quickFieldLabelClass} col-span-full`}>
            Repeats
            <select
              value={eventRecurrence}
              onChange={(e) => setEventRecurrence(e.target.value as Recurrence)}
              className={quickFieldClass}
            >
              <option value="NONE">No recurrence</option>
              <option value="DAILY">Daily</option>
              <option value="WEEKLY">Weekly</option>
              <option value="BIWEEKLY">Biweekly</option>
              <option value="MONTHLY">Monthly</option>
            </select>
          </label>
          <button
            disabled={isSubmitting}
            className="col-span-full rounded-xl px-4 py-2 text-sm bg-accent font-medium text-accent-ink transition-colors hover:bg-accent-hover disabled:opacity-60"
          >
            {isSubmitting ? "Saving..." : "Create event"}
          </button>
        </form>
      ) : null}
    </section>
  );
}
