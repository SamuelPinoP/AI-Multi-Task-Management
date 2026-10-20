"use client";

import { useEffect, useState, type FormEvent } from "react";
import { uiButtonClass, uiDangerButtonClass, uiPrimaryButtonClass } from "@/components/ui";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatTaskDueDateInput } from "@/lib/task-date-buckets";
import {
  priorityLabels,
  recurrenceLabels,
  statusLabels,
  type Member,
  type Priority,
  type Project,
  type Recurrence,
  type Task,
  type TaskInput,
  type TaskStatus,
} from "./types";

const fieldClass =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/25 disabled:opacity-60";

const emptyInput: TaskInput = {
  title: "",
  description: "",
  status: "TODO",
  priority: "MEDIUM",
  dueDate: "",
  recurrence: "NONE",
  projectId: "",
  assigneeId: "",
};

function inputFromTask(task: Task): TaskInput {
  return {
    title: task.title,
    description: task.description ?? "",
    status: task.status,
    priority: task.priority,
    dueDate: task.dueDate ? formatTaskDueDateInput(task.dueDate) : "",
    recurrence: task.recurrence,
    projectId: task.projectId ?? "",
    assigneeId: task.assignee?.id ?? task.assigneeId ?? "",
  };
}

/** Members of a project, for the assignee select; cached per project for the session. */
const memberCache = new Map<string, Member[]>();

async function loadMembers(projectId: string) {
  const cached = memberCache.get(projectId);
  if (cached) return cached;
  const response = await fetch(`/api/projects/${projectId}`);
  if (!response.ok) return [];
  const project = (await response.json()) as { members?: Member[] };
  const members = project.members ?? [];
  memberCache.set(projectId, members);
  return members;
}

/**
 * The full create and edit form for a task, in a side sheet. The list page
 * owns the requests: `onSubmit` returns an error message, or null on success.
 */
export function TaskSheet({
  open,
  onOpenChange,
  task,
  projects,
  onSubmit,
  onDelete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The task to edit; leave it out to create one. */
  task?: Task | null;
  projects: Project[];
  onSubmit: (input: TaskInput) => Promise<string | null>;
  onDelete?: (task: Task) => void;
}) {
  const [input, setInput] = useState<TaskInput>(emptyInput);
  const [members, setMembers] = useState<Member[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  // Reset the form whenever the sheet opens for a different task (or for a new one).
  const formKey = open ? (task?.id ?? "new") : null;
  if (formKey !== loadedFor) {
    setLoadedFor(formKey);
    setInput(task ? inputFromTask(task) : emptyInput);
    setError(null);
  }

  useEffect(() => {
    if (!open || !input.projectId) return;
    let cancelled = false;
    void loadMembers(input.projectId).then((list) => {
      if (!cancelled) setMembers(list);
    });
    return () => {
      cancelled = true;
    };
  }, [open, input.projectId]);

  const set = <K extends keyof TaskInput>(key: K, value: TaskInput[K]) => setInput((current) => ({ ...current, [key]: value }));

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!input.title.trim()) {
      setError("Give the task a title.");
      return;
    }
    setSaving(true);
    setError(null);
    const message = await onSubmit({ ...input, title: input.title.trim() });
    setSaving(false);
    if (message) setError(message);
    else onOpenChange(false);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{task ? "Edit task" : "New task"}</SheetTitle>
          <SheetDescription>{task ? "Change any detail, then save." : "Add the details now or later."}</SheetDescription>
        </SheetHeader>
        <form className="grid gap-4" onSubmit={handleSubmit}>
          <label className="grid gap-1.5 text-sm font-medium">
            Title
            <input value={input.title} onChange={(event) => set("title", event.target.value)} maxLength={200} autoFocus className={fieldClass} />
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            Description
            <textarea
              value={input.description}
              onChange={(event) => set("description", event.target.value)}
              rows={4}
              placeholder="Optional"
              className={fieldClass}
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1.5 text-sm font-medium">
              Status
              <select value={input.status} onChange={(event) => set("status", event.target.value as TaskStatus)} className={fieldClass}>
                {(Object.keys(statusLabels) as TaskStatus[]).map((value) => (
                  <option key={value} value={value}>{statusLabels[value]}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Priority
              <select value={input.priority} onChange={(event) => set("priority", event.target.value as Priority)} className={fieldClass}>
                {(Object.keys(priorityLabels) as Priority[]).map((value) => (
                  <option key={value} value={value}>{priorityLabels[value]}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Due date
              <input type="date" value={input.dueDate} onChange={(event) => set("dueDate", event.target.value)} className={fieldClass} />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Repeats
              <select value={input.recurrence} onChange={(event) => set("recurrence", event.target.value as Recurrence)} className={fieldClass}>
                {(Object.keys(recurrenceLabels) as Recurrence[]).map((value) => (
                  <option key={value} value={value}>{recurrenceLabels[value]}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Project
              <select
                value={input.projectId}
                onChange={(event) => setInput((current) => ({ ...current, projectId: event.target.value, assigneeId: "" }))}
                className={fieldClass}
              >
                <option value="">No project</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>{project.name}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Assignee
              <select
                value={input.assigneeId}
                onChange={(event) => set("assigneeId", event.target.value)}
                disabled={!input.projectId}
                className={fieldClass}
              >
                <option value="">{input.projectId ? "Unassigned" : "Pick a project first"}</option>
                {(input.projectId ? members : []).map((member) => (
                  <option key={member.id} value={member.id}>{member.name}</option>
                ))}
              </select>
            </label>
          </div>
          {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button type="submit" disabled={saving} className={uiPrimaryButtonClass}>
              {saving ? "Saving..." : task ? "Save changes" : "Create task"}
            </button>
            <button type="button" onClick={() => onOpenChange(false)} disabled={saving} className={uiButtonClass}>
              Cancel
            </button>
            {task && onDelete ? (
              <button type="button" onClick={() => onDelete(task)} disabled={saving} className={`${uiDangerButtonClass} ml-auto`}>
                Delete
              </button>
            ) : null}
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
