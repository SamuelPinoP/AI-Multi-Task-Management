"use client";

import { useState, type FormEvent } from "react";
import { uiButtonClass, uiDangerButtonClass, uiPrimaryButtonClass } from "@/components/ui";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { eventTimeInputValue } from "@/lib/event-time";
import { normalizeRecurrence } from "@/lib/recurrence";
import { formatTaskDayKey } from "@/lib/task-date-buckets";

export type Recurrence = "NONE" | "DAILY" | "WEEKLY" | "BIWEEKLY" | "MONTHLY";

export type EventProject = { id: string; name: string; color: string | null };

/** An event as /api/events returns it; times are stored wall-clock values (see @/lib/event-time). */
export type EventItem = {
  id: string;
  /** On expanded repeat occurrences: the stored event's id. */
  sourceEventId?: string;
  title: string;
  description: string | null;
  location: string | null;
  startTime: string;
  endTime: string | null;
  hasStartTime: boolean;
  hasEndTime: boolean;
  createdAt: string;
  updatedAt: string;
  recurrence?: Recurrence | null;
  projectId?: string | null;
  project?: EventProject | null;
};

export type EventInput = {
  title: string;
  description: string;
  location: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  recurrence: Recurrence;
  projectId: string;
};

const recurrenceLabels: Record<Recurrence, string> = {
  NONE: "Does not repeat",
  DAILY: "Daily",
  WEEKLY: "Weekly",
  BIWEEKLY: "Every 2 weeks",
  MONTHLY: "Monthly",
};

const fieldClass =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/25";

/** Returns an error message, or "" when the dates and times make sense. */
export function validateEventInput(input: Pick<EventInput, "title" | "startDate" | "startTime" | "endDate" | "endTime">) {
  if (!input.title.trim()) return "Give the event a title.";
  if (!input.startDate) return "Pick a start date.";
  if (input.endDate && input.endDate < input.startDate) return "The end date can't be before the start date.";
  if (input.endDate && input.endDate === input.startDate && input.startTime && input.endTime && input.endTime <= input.startTime) {
    return "The end time must be after the start time on the same day.";
  }
  return "";
}

function inputFromEvent(event: EventItem): EventInput {
  return {
    title: event.title,
    description: event.description ?? "",
    location: event.location ?? "",
    startDate: formatTaskDayKey(event.startTime),
    startTime: event.hasStartTime ? eventTimeInputValue(event.startTime) : "",
    endDate: event.endTime ? formatTaskDayKey(event.endTime) : "",
    endTime: event.endTime && event.hasEndTime ? eventTimeInputValue(event.endTime) : "",
    recurrence: normalizeRecurrence(event.recurrence),
    projectId: event.projectId ?? "",
  };
}

/**
 * Create or edit an event in a side sheet. `draft` prefills a new event
 * (for example the title typed in quick entry and the selected day).
 */
export function EventSheet({
  open,
  onOpenChange,
  event,
  draft,
  projects,
  onSubmit,
  onDelete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event?: EventItem | null;
  draft?: Partial<EventInput>;
  projects: EventProject[];
  onSubmit: (input: EventInput) => Promise<string | null>;
  onDelete?: (event: EventItem) => void;
}) {
  const blank: EventInput = {
    title: "",
    description: "",
    location: "",
    startDate: "",
    startTime: "",
    endDate: "",
    endTime: "",
    recurrence: "NONE",
    projectId: "",
  };
  const [input, setInput] = useState<EventInput>(blank);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  const formKey = open ? (event?.id ?? `new:${draft?.title ?? ""}:${draft?.startDate ?? ""}`) : null;
  if (formKey !== loadedFor) {
    setLoadedFor(formKey);
    setInput(event ? inputFromEvent(event) : { ...blank, ...draft });
    setError(null);
  }

  const set = <K extends keyof EventInput>(key: K, value: EventInput[K]) => setInput((current) => ({ ...current, [key]: value }));

  async function handleSubmit(formEvent: FormEvent) {
    formEvent.preventDefault();
    const problem = validateEventInput(input);
    if (problem) {
      setError(problem);
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
          <SheetTitle>{event ? "Edit event" : "New event"}</SheetTitle>
          <SheetDescription>
            {event?.recurrence && event.recurrence !== "NONE"
              ? "Changes apply to every repeat of this event."
              : "Leave the times empty for an all-day event."}
          </SheetDescription>
        </SheetHeader>
        <form className="grid gap-4" onSubmit={handleSubmit}>
          <label className="grid gap-1.5 text-sm font-medium">
            Title
            <input value={input.title} onChange={(e) => set("title", e.target.value)} maxLength={200} autoFocus className={fieldClass} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1.5 text-sm font-medium">
              Starts
              <input type="date" value={input.startDate} onChange={(e) => set("startDate", e.target.value)} className={fieldClass} />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Start time
              <input type="time" value={input.startTime} onChange={(e) => set("startTime", e.target.value)} className={fieldClass} />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Ends
              <input type="date" value={input.endDate} min={input.startDate || undefined} onChange={(e) => set("endDate", e.target.value)} className={fieldClass} />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              End time
              <input type="time" value={input.endTime} onChange={(e) => set("endTime", e.target.value)} className={fieldClass} />
            </label>
          </div>
          <label className="grid gap-1.5 text-sm font-medium">
            Location
            <input value={input.location} onChange={(e) => set("location", e.target.value)} placeholder="Optional" className={fieldClass} />
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            Description
            <textarea value={input.description} onChange={(e) => set("description", e.target.value)} rows={3} placeholder="Optional" className={fieldClass} />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5 text-sm font-medium">
              Repeats
              <select value={input.recurrence} onChange={(e) => set("recurrence", e.target.value as Recurrence)} className={fieldClass}>
                {(Object.keys(recurrenceLabels) as Recurrence[]).map((value) => (
                  <option key={value} value={value}>{recurrenceLabels[value]}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Project
              <select value={input.projectId} onChange={(e) => set("projectId", e.target.value)} className={fieldClass}>
                <option value="">No project</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>{project.name}</option>
                ))}
              </select>
            </label>
          </div>
          {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button type="submit" disabled={saving} className={uiPrimaryButtonClass}>
              {saving ? "Saving..." : event ? "Save changes" : "Create event"}
            </button>
            <button type="button" onClick={() => onOpenChange(false)} disabled={saving} className={uiButtonClass}>
              Cancel
            </button>
            {event && onDelete ? (
              <button type="button" onClick={() => onDelete(event)} disabled={saving} className={`${uiDangerButtonClass} ml-auto`}>
                Delete
              </button>
            ) : null}
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
