"use client";

import { Check } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "@/components/ui/toaster";
import { cn } from "@/lib/cn";
import type { HomeFocusTask } from "@/lib/home-data";
import { paletteColor, projectColor } from "@/lib/project-color";
import { formatTaskDueDateInput } from "@/lib/task-date-buckets";
import { notifyWorkspaceChanged } from "@/lib/workspace-events";

export type FocusRow = HomeFocusTask & { dueLabel: string | null; late: boolean };

const priorityLabel = { HIGH: "High", MEDIUM: "Med", LOW: "Low" } as const;

async function saveStatus(task: HomeFocusTask, status: HomeFocusTask["status"]) {
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

/** The Focus card's rows: complete a task in place, with Undo. */
export function FocusList({ tasks }: { tasks: FocusRow[] }) {
  const router = useRouter();
  const [completedIds, setCompletedIds] = useState<string[]>([]);
  const visible = tasks.filter((task) => !completedIds.includes(task.id));

  async function complete(task: FocusRow) {
    setCompletedIds((ids) => [...ids, task.id]);
    try {
      await saveStatus(task, "DONE");
      notifyWorkspaceChanged();
      router.refresh();
      toast.success("Task completed", {
        description: task.title,
        action: {
          label: "Undo",
          onClick: async () => {
            try {
              await saveStatus(task, task.status);
              setCompletedIds((ids) => ids.filter((id) => id !== task.id));
              notifyWorkspaceChanged();
              router.refresh();
            } catch (error) {
              toast.error(error instanceof Error ? error.message : "Could not undo.");
            }
          },
        },
      });
    } catch (error) {
      setCompletedIds((ids) => ids.filter((id) => id !== task.id));
      toast.error(error instanceof Error ? error.message : "Could not complete the task.");
    }
  }

  if (!visible.length) {
    return <p className="py-3 text-sm text-muted">All clear. Nice work.</p>;
  }

  return (
    <ul>
      {visible.map((task) => (
        <li key={task.id} className="flex items-center gap-2.5 border-t border-line py-2 first:border-t-0">
          <button
            type="button"
            onClick={() => void complete(task)}
            aria-label={`Complete ${task.title}`}
            className="group grid h-4 w-4 shrink-0 place-items-center rounded border-[1.5px] border-muted transition-colors hover:border-accent hover:bg-accent-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <Check aria-hidden="true" className="h-3 w-3 text-accent opacity-0 group-hover:opacity-100" />
          </button>
          <Link href={`/tasks?task=${task.id}`} className="min-w-0 flex-1 truncate text-sm hover:text-accent">
            {task.title}
          </Link>
          <span
            className={cn(
              "shrink-0 rounded border px-1.5 text-2xs font-bold",
              task.priority === "HIGH" ? "border-danger/35 text-danger" : "border-line bg-canvas text-muted",
            )}
          >
            {priorityLabel[task.priority]}
          </span>
          {task.project ? (
            <span className="hidden max-w-28 shrink-0 items-center gap-1.5 truncate text-xs text-muted sm:inline-flex">
              <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-[3px]" style={{ backgroundColor: projectColor(task.project) }} />
              <span className="truncate">{task.project.name}</span>
            </span>
          ) : null}
          {task.dueLabel ? (
            <span className={cn("shrink-0 whitespace-nowrap text-xs", task.late ? "font-semibold text-danger" : "text-muted")}>
              {task.dueLabel}
            </span>
          ) : null}
          {task.assignee ? (
            <span
              title={`Assigned to ${task.assignee.name}`}
              className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-2xs font-bold text-white"
              style={{ backgroundColor: paletteColor(task.assignee.id) }}
            >
              <span aria-hidden="true">{task.assignee.name.charAt(0).toUpperCase()}</span>
              <span className="sr-only">Assigned to {task.assignee.name}</span>
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
