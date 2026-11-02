"use client";

import { CalendarPlus, FilePlus, ListPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { EventSheet, eventRequestBody, type EventInput } from "@/components/events/event-sheet";
import { TaskSheet, taskRequestBody } from "@/components/tasks/task-sheet";
import type { TaskInput } from "@/components/tasks/types";
import { uiButtonClass, uiPrimaryButtonClass } from "@/components/ui";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toaster";
import { cn } from "@/lib/cn";
import { formatTaskDayKey } from "@/lib/task-date-buckets";
import { notifyWorkspaceChanged } from "@/lib/workspace-events";

type ProjectSummary = { id: string; name: string; color: string | null };
type QuickAction = "NOTE" | "TASK" | "EVENT";

const actions = [
  { kind: "TASK", label: "New task", icon: ListPlus },
  { kind: "NOTE", label: "New note", icon: FilePlus },
  { kind: "EVENT", label: "New event", icon: CalendarPlus },
] as const;

const fieldClass =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/25";

async function errorMessage(response: Response, fallback: string) {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? fallback;
}

/**
 * Quick Actions on a project page (DES-18): three buttons that open the same
 * New task and New event sheets as the Tasks page and the Calendar, with this
 * project chosen, plus a small New note sheet. On a phone they slide up from
 * the bottom.
 */
export function ProjectQuickActions({ project }: { project: ProjectSummary }) {
  const router = useRouter();
  const [open, setOpen] = useState<QuickAction | null>(null);
  const sheetProps = (kind: QuickAction) => ({
    open: open === kind,
    onOpenChange: (next: boolean) => setOpen(next ? kind : null),
  });

  /** The page's sections are server-rendered, so a refresh shows the new item. */
  function showCreated(what: string, title: string) {
    notifyWorkspaceChanged();
    router.refresh();
    toast.success(`${what} created`, { description: title });
  }

  async function createTask(input: TaskInput) {
    const response = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(taskRequestBody(input)),
    });
    if (!response.ok) return errorMessage(response, "Could not create the task.");
    showCreated("Task", input.title);
    return null;
  }

  async function createEvent(input: EventInput) {
    const response = await fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(eventRequestBody(input)),
    });
    if (!response.ok) return errorMessage(response, "Could not create the event.");
    showCreated("Event", input.title);
    return null;
  }

  return (
    <section aria-labelledby="quick-actions-heading" className="mt-8 rounded-2xl border border-zinc-200 p-4 shadow-sm dark:border-zinc-800 sm:p-6">
      <h2 id="quick-actions-heading" className="text-lg font-semibold sm:text-2xl">Quick Actions</h2>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">Add a task, note or event to this project.</p>

      <div className="mt-3 grid grid-cols-3 gap-2 sm:mt-4 sm:flex sm:flex-wrap">
        {actions.map(({ kind, label, icon: Icon }) => (
          <button
            key={kind}
            type="button"
            onClick={() => setOpen(kind)}
            aria-haspopup="dialog"
            className={cn(uiButtonClass, "flex-col gap-1 px-2 py-3 sm:flex-row sm:gap-2 sm:px-4 sm:py-2")}
          >
            <Icon aria-hidden="true" className="h-5 w-5 text-accent sm:h-4 sm:w-4" />
            {label}
          </button>
        ))}
      </div>

      <TaskSheet {...sheetProps("TASK")} draft={{ projectId: project.id }} side="bottomOnPhone" projects={[project]} onSubmit={createTask} />
      <EventSheet
        {...sheetProps("EVENT")}
        draft={{ projectId: project.id, startDate: formatTaskDayKey(new Date()) }}
        side="bottomOnPhone"
        projects={[project]}
        onSubmit={createEvent}
      />
      <NoteSheet {...sheetProps("NOTE")} project={project} onCreated={(title) => showCreated("Note", title)} />
    </section>
  );
}

/** A small New note form: the Notes page edits notes in place, so there is no note sheet elsewhere. */
function NoteSheet({
  open,
  onOpenChange,
  project,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: ProjectSummary;
  onCreated: (title: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const title = String(data.get("title") ?? "").trim();
    const content = String(data.get("content") ?? "").trim();
    if (!title && !content) {
      setError("Give the note a title or some text.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, content, projectId: project.id }),
      });
      if (!response.ok) {
        setError(await errorMessage(response, "Could not create the note."));
        return;
      }
      form.reset();
      onOpenChange(false);
      onCreated(title || "Untitled note");
    } catch {
      setError("Could not create the note. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) setError(null);
        onOpenChange(next);
      }}
    >
      <SheetContent side="bottomOnPhone">
        <SheetHeader>
          <SheetTitle>New note</SheetTitle>
          <SheetDescription>Saved to {project.name}.</SheetDescription>
        </SheetHeader>
        <form className="grid gap-4" onSubmit={handleSubmit}>
          <label className="grid gap-1.5 text-sm font-medium">
            Title
            <input name="title" maxLength={200} placeholder="Optional" autoFocus className={fieldClass} />
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            Note
            <textarea name="content" rows={6} placeholder="Decisions, links, meeting notes…" className={fieldClass} />
          </label>
          {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button type="submit" disabled={saving} className={uiPrimaryButtonClass}>
              {saving ? "Saving..." : "Create note"}
            </button>
            <button type="button" onClick={() => onOpenChange(false)} disabled={saving} className={uiButtonClass}>
              Cancel
            </button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
