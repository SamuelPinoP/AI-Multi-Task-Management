"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { uiButtonClass, uiPrimaryButtonClass } from "@/components/ui";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toaster";
import { notifyWorkspaceChanged, TASK_CREATED_EVENT } from "@/lib/workspace-events";

type ProjectOption = { id: string; name: string };

const fieldClass =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/25";

export function NewTaskDialog({
  open,
  onOpenChange,
  projects,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: ProjectOption[];
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const title = String(data.get("title") ?? "").trim();
    if (!title) {
      setError("Give the task a title.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          dueDate: data.get("dueDate") || undefined,
          priority: data.get("priority"),
          projectId: data.get("projectId") || undefined,
        }),
      });
      const body = (await response.json().catch(() => null)) as { id?: string; error?: string } | null;
      if (!response.ok || !body?.id) {
        setError(body?.error ?? "Could not create the task. Try again.");
        return;
      }

      form.reset();
      onOpenChange(false);
      notifyWorkspaceChanged();
      window.dispatchEvent(new Event(TASK_CREATED_EVENT));
      const taskId = body.id;
      toast.success("Task added", {
        description: title,
        action: { label: "View", onClick: () => router.push(`/tasks?task=${taskId}`) },
      });
    } catch {
      setError("Could not create the task. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setError(null);
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New task</DialogTitle>
          <DialogDescription>Add the essentials now; edit the details later on the Tasks page.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={handleSubmit}>
          <label className="grid gap-1.5 text-sm font-medium">
            Title
            <input name="title" required autoFocus maxLength={200} placeholder="What needs to get done?" className={fieldClass} />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1.5 text-sm font-medium">
              Due date
              <input name="dueDate" type="date" className={fieldClass} />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Priority
              <select name="priority" defaultValue="MEDIUM" className={fieldClass}>
                <option value="HIGH">High</option>
                <option value="MEDIUM">Medium</option>
                <option value="LOW">Low</option>
              </select>
            </label>
          </div>
          <label className="grid gap-1.5 text-sm font-medium">
            Project
            <select name="projectId" defaultValue="" className={fieldClass}>
              <option value="">No project</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>{project.name}</option>
              ))}
            </select>
          </label>
          {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
          <DialogFooter>
            <button type="button" className={uiButtonClass} onClick={() => onOpenChange(false)} disabled={saving}>Cancel</button>
            <button type="submit" className={uiPrimaryButtonClass} disabled={saving}>{saving ? "Adding..." : "Add task"}</button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
