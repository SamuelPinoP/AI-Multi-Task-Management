"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatTaskDueDate } from "@/lib/task-date-buckets";

type TaskStatus = "TODO" | "IN_PROGRESS" | "DONE";
type Priority = "LOW" | "MEDIUM" | "HIGH";
type Recurrence = "NONE" | "DAILY" | "WEEKLY" | "BIWEEKLY" | "MONTHLY";

type Member = { id: string; name: string };

type Task = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: Priority;
  dueDate: string | null;
  recurrence: Recurrence;
  assignee: { id: string; name: string } | null;
};

type ProjectAssignedTasksSectionProps = {
  projectId: string;
  tasks: Task[];
  members: Member[];
};

export function ProjectAssignedTasksSection({ projectId, tasks, members }: ProjectAssignedTasksSectionProps) {
  const router = useRouter();
  const [updatingTaskId, setUpdatingTaskId] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function handleAssigneeChange(task: Task, nextAssigneeId: string) {
    try {
      setUpdatingTaskId(task.id);
      setError("");

      const res = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: task.title,
          description: task.description ?? "",
          status: task.status,
          priority: task.priority,
          dueDate: task.dueDate,
          recurrence: task.recurrence,
          projectId,
          assigneeId: nextAssigneeId,
        }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error || "Failed to update assignee");
      }

      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update assignee.");
    } finally {
      setUpdatingTaskId(null);
    }
  }

  return (
    <section className="mt-8">
      <h2 className="mb-4 text-2xl font-semibold">Assigned Tasks</h2>
      {error ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}
      {tasks.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-zinc-300 p-5 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">
          No tasks are assigned to this project yet.
        </p>
      ) : (
        <div className="space-y-4">
          {tasks.map((task) => {
            const currentAssigneeId = task.assignee?.id ?? "";
            const isUpdating = updatingTaskId === task.id;

            return (
              <article key={task.id} className="rounded-2xl border border-zinc-200 p-5 shadow-sm dark:border-zinc-800">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-semibold">{task.title}</h3>
                    <p className="mt-2 text-zinc-700 dark:text-zinc-300">{task.description || "No description."}</p>
                  </div>
                  <div className="min-w-44">
                    <label htmlFor={`assignee-${task.id}`} className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">
                      Assignee
                    </label>
                    <select
                      id={`assignee-${task.id}`}
                      value={currentAssigneeId}
                      disabled={isUpdating}
                      onChange={(event) => void handleAssigneeChange(task, event.target.value)}
                      className="w-full rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-black disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900"
                    >
                      <option value="">Unassigned</option>
                      {members.map((member) => (
                        <option key={member.id} value={member.id}>
                          {member.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-3 text-sm text-zinc-600 dark:text-zinc-300">
                  <span>Status: <strong>{task.status}</strong></span>
                  <span>Priority: <strong>{task.priority}</strong></span>
                  <span>Due: <strong>{task.dueDate ? formatTaskDueDate(task.dueDate) : "No due date"}</strong></span>
                  <span>Assigned to: <strong>{task.assignee?.name ?? "Unassigned"}</strong></span>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
