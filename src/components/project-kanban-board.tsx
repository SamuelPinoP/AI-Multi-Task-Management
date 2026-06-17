"use client";

import { uiButtonClass, uiPrimaryButtonClass } from "@/components/ui";
import { useMemo, useState } from "react";

type TaskStatus = "TODO" | "IN_PROGRESS" | "DONE";
type Priority = "LOW" | "MEDIUM" | "HIGH";
type Recurrence = "NONE" | "DAILY" | "WEEKLY" | "BIWEEKLY" | "MONTHLY";

type Member = { id: string; name: string; email?: string | null; role: "OWNER" | "EDITOR" | "VIEWER" };

type ProjectOption = { id: string; name: string; color: string | null };

type Task = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: Priority;
  dueDate: string | null;
  recurrence: Recurrence;
  projectId: string | null;
  assigneeId?: string | null;
  assignee: Member | null;
  project?: ProjectOption | null;
};

type ProjectKanbanBoardProps = {
  projectId?: string | null;
  projectName: string;
  initialTasks: Task[];
  members: Member[];
  canEdit: boolean;
  projects?: ProjectOption[];
};

const STATUS_COLUMNS: Array<{ status: TaskStatus; title: string; help: string }> = [
  { status: "TODO", title: "To Do", help: "Planned work that has not started yet." },
  { status: "IN_PROGRESS", title: "In Progress", help: "Active work currently being handled." },
  { status: "DONE", title: "Done", help: "Completed work for this project." },
];

const PRIORITIES: Priority[] = ["LOW", "MEDIUM", "HIGH"];

function formatEnum(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getLocalDayStart(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function getDueIndicator(task: Task): { label: string; className: string } | null {
  if (!task.dueDate || task.status === "DONE") return null;
  const dueDate = getLocalDayStart(new Date(task.dueDate));
  const today = getLocalDayStart(new Date());
  const dayDiff = Math.floor((dueDate.getTime() - today.getTime()) / 86400000);
  if (dayDiff < 0) return { label: "Overdue", className: "border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300" };
  if (dayDiff === 0) return { label: "Due today", className: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300" };
  return null;
}

export function ProjectKanbanBoard({ projectId = null, projectName, initialTasks, members, canEdit, projects = [] }: ProjectKanbanBoardProps) {
  const [tasks, setTasks] = useState(initialTasks);
  const [error, setError] = useState("");
  const [updatingTaskId, setUpdatingTaskId] = useState<string | null>(null);
  const [creatingStatus, setCreatingStatus] = useState<TaskStatus | null>(null);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskPriority, setNewTaskPriority] = useState<Priority>("MEDIUM");
  const [newTaskDueDate, setNewTaskDueDate] = useState("");
  const [newTaskAssigneeId, setNewTaskAssigneeId] = useState("");
  const [newTaskProjectId, setNewTaskProjectId] = useState(projectId ?? "");

  const taskCounts = useMemo(() => new Map(STATUS_COLUMNS.map((column) => [column.status, tasks.filter((task) => task.status === column.status).length])), [tasks]);

  async function moveTask(task: Task, status: TaskStatus) {
    if (!canEdit || task.status === status) return;
    const previousTasks = tasks;
    setTasks((current) => current.map((item) => (item.id === task.id ? { ...item, status } : item)));
    setUpdatingTaskId(task.id);
    setError("");
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: task.title,
          description: task.description ?? "",
          status,
          priority: task.priority,
          dueDate: task.dueDate,
          recurrence: task.recurrence,
          projectId: task.projectId,
          assigneeId: task.assignee?.id ?? "",
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Failed to update task status.");
      }
      const updatedTask = (await res.json()) as Task;
      setTasks((current) => current.map((item) => (item.id === task.id ? updatedTask : item)));
    } catch (err) {
      setTasks(previousTasks);
      setError(err instanceof Error ? err.message : "Could not update task status.");
    } finally {
      setUpdatingTaskId(null);
    }
  }

  async function createTask(status: TaskStatus) {
    if (!canEdit || !newTaskTitle.trim()) return;
    setUpdatingTaskId("new-task");
    setError("");
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newTaskTitle,
          status,
          priority: newTaskPriority,
          dueDate: newTaskDueDate || null,
          projectId: projectId ?? (newTaskProjectId || null),
          assigneeId: newTaskAssigneeId,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Failed to create task.");
      }
      const createdTask = (await res.json()) as Task;
      setTasks((current) => [createdTask, ...current]);
      setNewTaskTitle("");
      setNewTaskPriority("MEDIUM");
      setNewTaskDueDate("");
      setNewTaskAssigneeId("");
      if (!projectId) setNewTaskProjectId("");
      setCreatingStatus(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create task.");
    } finally {
      setUpdatingTaskId(null);
    }
  }

  return (
    <div className="space-y-4">
      <section className="flex flex-col gap-3 rounded-[1.5rem] border border-zinc-200 bg-white/95 p-4 shadow-sm shadow-zinc-200/60 dark:border-zinc-800 dark:bg-zinc-900/70 dark:shadow-none sm:p-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-400">Kanban View</p>
          <h1 className="mt-1 truncate text-2xl font-bold tracking-tight">{projectName}</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {canEdit ? "Move cards or create new tasks directly on the board." : "Viewer access is read-only."}
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center text-sm sm:min-w-72">
          {STATUS_COLUMNS.map((column) => <div key={column.status} className="rounded-xl border border-zinc-200 bg-zinc-50/70 p-3 dark:border-zinc-800 dark:bg-zinc-950/40"><p className="font-semibold">{taskCounts.get(column.status) ?? 0}</p><p className="text-xs text-zinc-500">{column.title}</p></div>)}
        </div>
      </section>

      {error && <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">{error}</p>}

      <div className="grid gap-4 lg:grid-cols-3">
        {STATUS_COLUMNS.map((column) => {
          const columnTasks = tasks.filter((task) => task.status === column.status);
          return (
            <section key={column.status} className="flex min-h-96 flex-col rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div><h2 className="text-lg font-semibold">{column.title}</h2><p className="text-xs text-zinc-500 dark:text-zinc-400">{column.help}</p></div>
                <span className="rounded-full bg-zinc-200 px-2 py-0.5 text-xs font-medium dark:bg-zinc-700">{columnTasks.length}</span>
              </div>

              {canEdit && (creatingStatus === column.status ? (
                <div className="mb-3 rounded-xl border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
                  <input value={newTaskTitle} onChange={(e) => setNewTaskTitle(e.target.value)} placeholder="Task title" className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
                  <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                    <select value={newTaskPriority} onChange={(e) => setNewTaskPriority(e.target.value as Priority)} className="rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900">{PRIORITIES.map((priority) => <option key={priority} value={priority}>{formatEnum(priority)}</option>)}</select>
                    <input type="date" value={newTaskDueDate} onChange={(e) => setNewTaskDueDate(e.target.value)} className="rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
                  </div>
                  {!projectId && projects.length > 0 && <select value={newTaskProjectId} onChange={(e) => { setNewTaskProjectId(e.target.value); setNewTaskAssigneeId(""); }} className="mt-2 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"><option value="">Personal task</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select>}
                  {members.length > 0 && <select value={newTaskAssigneeId} onChange={(e) => setNewTaskAssigneeId(e.target.value)} className="mt-2 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"><option value="">Unassigned</option>{members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select>}
                  <div className="mt-3 flex gap-2"><button type="button" onClick={() => void createTask(column.status)} disabled={updatingTaskId === "new-task" || !newTaskTitle.trim()} className={`${uiPrimaryButtonClass} px-3 py-1.5 text-xs`}>Create</button><button type="button" onClick={() => setCreatingStatus(null)} className={`${uiButtonClass} px-3 py-1.5 text-xs`}>Cancel</button></div>
                </div>
              ) : <button type="button" onClick={() => setCreatingStatus(column.status)} className={`${uiButtonClass} mb-3 w-full border-dashed py-2 text-xs`}>+ Add task to {column.title}</button>)}

              {columnTasks.length === 0 ? <p className="rounded-xl border border-dashed border-zinc-300 px-3 py-8 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">No tasks in {column.title.toLowerCase()} yet.</p> : <div className="space-y-3">{columnTasks.map((task) => {
                const dueIndicator = getDueIndicator(task);
                return <article key={task.id} className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950"><div className="flex items-start justify-between gap-3"><h3 className="font-semibold">{task.title}</h3><span className="rounded-full border border-zinc-300 px-2 py-0.5 text-xs dark:border-zinc-700">{formatEnum(task.status)}</span></div>{task.description && <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">{task.description}</p>}<div className="mt-3 flex flex-wrap gap-2"><span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-300">Priority: {formatEnum(task.priority)}</span>{task.dueDate && <span className="rounded-full border border-zinc-300 px-2.5 py-1 text-xs font-medium dark:border-zinc-700">Due: {new Date(task.dueDate).toLocaleDateString()}</span>}{task.assignee && <span className="rounded-full border border-zinc-300 px-2.5 py-1 text-xs font-medium dark:border-zinc-700">Assigned: {task.assignee.name}</span>}{dueIndicator && <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${dueIndicator.className}`}>{dueIndicator.label}</span>}</div>{canEdit && <div className="mt-4 flex flex-wrap gap-2">{STATUS_COLUMNS.filter((option) => option.status !== task.status).map((option) => <button key={option.status} type="button" disabled={updatingTaskId === task.id} onClick={() => void moveTask(task, option.status)} className={`${uiButtonClass} rounded-lg px-2.5 py-1.5 text-xs`}>Move to {option.title}</button>)}</div>}</article>;
              })}</div>}
            </section>
          );
        })}
      </div>
    </div>
  );
}
