"use client";

import { CalendarDays, CalendarRange, Repeat, Trash2, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { uiButtonClass } from "@/components/ui";
import { DeleteButton } from "@/components/ui/delete-button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toaster";
import { cn } from "@/lib/cn";
import { formatRecurrenceLabel, normalizeRecurrence, storedDayKey, type RecurrenceValue } from "@/lib/recurrence";

/** Which days a delete covers (CAL-03): one day, that day and later ones, or the whole series. */
export type DeleteScope = "day" | "following" | "series";

/** The event being deleted: the stored series, and the day it was picked on (null when there's none, as from a link). */
export type DeleteEventTarget = {
  event: {
    id: string;
    title: string;
    startTime: string;
    recurrence?: RecurrenceValue | null;
    repeatUntil?: string | null;
  };
  /** `YYYY-MM-DD` of the occurrence's first day. */
  day: string | null;
};

/** What changes on the series when days are deleted or brought back. */
export type SeriesDays = { repeatUntil: string | null; skippedDates: string[] };

function dayDate(day: string) {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year, month - 1, date);
}

function shortDay(day: string) {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" }).format(dayDate(day));
}

function longDay(day: string) {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(dayDate(day));
}

/** The day before `day`, as `YYYY-MM-DD`. */
function dayBefore(day: string) {
  return storedDayKey(new Date(Date.parse(`${day}T00:00:00.000Z`) - 86_400_000));
}

/** Whether the target offers a choice of days: a repeating event, picked on a day. */
function choosesDays(target: DeleteEventTarget | null): target is DeleteEventTarget & { day: string } {
  return Boolean(target?.day) && normalizeRecurrence(target?.event.recurrence) !== "NONE";
}

/** A body for PATCH /api/events/[id]/repeats: exactly one change. */
type RepeatsChange = { skipDate: string } | { restoreDate: string } | { repeatUntil: string | null };

async function changeRepeats(eventId: string, body: RepeatsChange): Promise<SeriesDays> {
  const response = await fetch(`/api/events/${eventId}/repeats`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => null)) as (SeriesDays & { error?: string }) | null;
  if (!response.ok || !data) throw new Error(data?.error ?? "Could not change the event.");
  return { repeatUntil: data.repeatUntil, skippedDates: data.skippedDates };
}

/**
 * Deletes the days `scope` covers, then confirms with a toast. Deleting days
 * keeps the series, so the toast offers Undo; the whole series goes to Trash.
 * `onChanged` gets the series' new days (also after Undo), `onDeleted` runs
 * when the series moved to Trash. Returns false (after an error toast) when
 * nothing changed.
 */
export async function deleteEventDays(
  target: DeleteEventTarget,
  scope: DeleteScope,
  { onChanged, onDeleted }: { onChanged: (eventId: string, days: SeriesDays) => void; onDeleted: (eventId: string) => void },
) {
  const { event, day } = target;
  try {
    if (scope === "series" || !day) {
      const response = await fetch(`/api/events/${event.id}`, { method: "DELETE" });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "Could not delete the event.");
      }
      onDeleted(event.id);
      toast.success("Moved to Trash", { description: event.title });
      return true;
    }

    const previousUntil = event.repeatUntil ? storedDayKey(event.repeatUntil) : null;
    const change: RepeatsChange = scope === "day" ? { skipDate: day } : { repeatUntil: dayBefore(day) };
    const undo: RepeatsChange = scope === "day" ? { restoreDate: day } : { repeatUntil: previousUntil };
    onChanged(event.id, await changeRepeats(event.id, change));
    toast.success(scope === "day" ? `Deleted ${shortDay(day)}` : `Deleted ${shortDay(day)} and later`, {
      description: event.title,
      action: {
        label: "Undo",
        onClick: () => {
          changeRepeats(event.id, undo)
            .then((days) => {
              onChanged(event.id, days);
              toast.success("Brought back", { description: event.title });
            })
            .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Could not undo."));
        },
      },
    });
    return true;
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Could not delete the event.");
    return false;
  }
}

type Choice = { value: DeleteScope; icon: LucideIcon; title: string; detail: string };

/**
 * Confirms deleting an event. A repeating event picked on a day asks which
 * days to delete: only that day, that day and the ones after it, or every
 * day. Other events confirm the move to Trash.
 */
export function DeleteEventDialog({
  target,
  loading,
  onCancel,
  onConfirm,
}: {
  target: DeleteEventTarget | null;
  loading: boolean;
  onCancel: () => void;
  onConfirm: (scope: DeleteScope) => void;
}) {
  const [scope, setScope] = useState<DeleteScope>("day");
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const targetKey = target ? `${target.event.id}:${target.day ?? ""}` : null;
  if (targetKey !== loadedFor) {
    setLoadedFor(targetKey);
    setScope("day");
  }

  const repeats = normalizeRecurrence(target?.event.recurrence) !== "NONE";
  let choices: Choice[] = [];
  if (choosesDays(target)) {
    const { event, day } = target;
    const isFirstDay = day <= storedDayKey(event.startTime);
    choices = [
      { value: "day", icon: CalendarDays, title: `Only ${longDay(day)}`, detail: "Every other day stays as it is." },
      // From the first day on, "this and later" is the whole series.
      ...(isFirstDay
        ? []
        : [{ value: "following" as const, icon: CalendarRange, title: `${shortDay(day)} and every day after`, detail: `Earlier days stay; the series ends on ${shortDay(dayBefore(day))}.` }]),
      { value: "series", icon: Repeat, title: "Every day", detail: "The whole series moves to Trash, where you can restore it." },
    ];
  }
  const chosen = choices.length ? scope : "series";

  return (
    <Dialog open={target !== null} onOpenChange={(open) => { if (!open && !loading) onCancel(); }}>
      <DialogContent className="max-w-md" hideClose>
        <div className="flex items-start gap-4">
          <span aria-hidden="true" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-danger-soft text-danger ring-4 ring-danger-soft/50">
            {choices.length ? <Repeat className="h-5 w-5" /> : <Trash2 className="h-5 w-5" />}
          </span>
          <DialogHeader className="pr-0 pt-0.5">
            <DialogTitle className="text-xl">{choices.length ? "Delete a repeating event" : "Delete this event?"}</DialogTitle>
            <DialogDescription>
              {target
                ? choices.length
                  ? `“${target.event.title}” repeats ${formatRecurrenceLabel(target.event.recurrence)}. Which days should go?`
                  : `“${target.event.title}”${repeats ? " and all its repeats" : ""} move to Trash, where you can restore it.`
                : ""}
            </DialogDescription>
          </DialogHeader>
        </div>
        {choices.length ? (
          <fieldset className="grid gap-2" disabled={loading}>
            <legend className="sr-only">Days to delete</legend>
            {choices.map(({ value, icon: Icon, title, detail }) => (
              <label
                key={value}
                className={cn(
                  "group/choice flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-surface px-3.5 py-3 transition-[border-color,background-color,box-shadow] duration-150",
                  "hover:border-danger/40 hover:bg-surface-hover",
                  "has-[:checked]:border-danger has-[:checked]:bg-danger-soft/40 has-[:checked]:shadow-sm has-[:checked]:shadow-danger/10",
                  "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-danger",
                )}
              >
                <input
                  type="radio"
                  name="delete-event-days"
                  value={value}
                  checked={chosen === value}
                  onChange={() => setScope(value)}
                  className="sr-only"
                />
                <span aria-hidden="true" className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-sunken text-muted transition-colors group-has-[:checked]/choice:bg-danger group-has-[:checked]/choice:text-white dark:group-has-[:checked]/choice:text-canvas">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{title}</span>
                  <span className="mt-0.5 block text-xs text-muted">{detail}</span>
                </span>
                <span aria-hidden="true" className="mt-1 grid h-4 w-4 shrink-0 place-items-center rounded-full border-2 border-line transition-colors group-has-[:checked]/choice:border-danger">
                  <span className="h-1.5 w-1.5 scale-0 rounded-full bg-danger transition-transform group-has-[:checked]/choice:scale-100" />
                </span>
              </label>
            ))}
          </fieldset>
        ) : null}
        <DialogFooter className="mt-1">
          <button type="button" onClick={onCancel} disabled={loading} className={uiButtonClass}>Cancel</button>
          <DeleteButton variant="solid" loading={loading} onClick={() => onConfirm(chosen)}>
            {chosen === "series" ? "Move to Trash" : "Delete"}
          </DeleteButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
