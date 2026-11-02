import type { HomeFocusTask } from "@/lib/home-data";
import { formatTaskDueDateInput } from "@/lib/task-date-buckets";

/** Sets a Home task's status: Focus completes tasks, the Now and next band starts them. */
export async function saveTaskStatus(task: HomeFocusTask, status: HomeFocusTask["status"]) {
  // The task API replaces every field, so send the task back with the new status.
  const response = await fetch(`/api/tasks/${task.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: task.title,
      description: task.description ?? "",
      status,
      priority: task.priority,
      dueDate: task.dueDate ? formatTaskDueDateInput(task.dueDate) : null,
      recurrence: task.recurrence,
      projectId: task.projectId ?? "",
      assigneeId: task.projectId ? (task.assigneeId ?? "") : "",
    }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? "Could not update the task.");
  }
}
