"use client";

import { useState, type ReactNode } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatTaskDayKey } from "@/lib/task-date-buckets";

function dayFromToday(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return formatTaskDayKey(date);
}

function nextMonday() {
  const date = new Date();
  date.setDate(date.getDate() + (((8 - date.getDay()) % 7) || 7));
  return formatTaskDayKey(date);
}

/** "Fri, Nov 13" for a `YYYY-MM-DD` key. */
export function dueDayName(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

/** Today, Tomorrow, Next week, any date, or none: the due date picker the task page and New task share. */
export function DueDatePicker({
  value,
  onChange,
  disabled = false,
  modal = false,
  children,
}: {
  /** `YYYY-MM-DD` or "". */
  value: string;
  onChange: (key: string | null) => void;
  disabled?: boolean;
  /** Inside a dialog: a click outside closes only this menu, not the dialog too (#362). */
  modal?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState(value);

  function pick(key: string | null) {
    setOpen(false);
    onChange(key);
  }

  return (
    <Popover
      modal={modal}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setInput(value);
      }}
    >
      <PopoverTrigger asChild disabled={disabled}>
        {children}
      </PopoverTrigger>
      <PopoverContent className="w-60 p-1">
        {[
          ["Today", dayFromToday(0)],
          ["Tomorrow", dayFromToday(1)],
          ["Next week", nextMonday()],
        ].map(([name, key]) => (
          <button
            key={name}
            type="button"
            onClick={() => pick(key)}
            className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-sm outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent"
          >
            {name}
            <span className="text-xs text-muted">{dueDayName(key)}</span>
          </button>
        ))}
        <form
          className="flex items-center gap-1.5 border-t border-line px-1.5 pb-1 pt-2"
          onSubmit={(event) => {
            event.preventDefault();
            // The menu renders in a portal, but React still bubbles this submit to any form
            // the picker sits in (New task, the quick add), which would save that form too.
            event.stopPropagation();
            if (input) pick(input);
          }}
        >
          <label className="sr-only" htmlFor="due-date-input">
            Pick a date
          </label>
          <input
            id="due-date-input"
            type="date"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 py-1 text-sm text-ink outline-none focus:border-accent"
          />
          <button type="submit" disabled={!input} className="rounded-lg bg-accent px-2.5 py-1 text-sm font-medium text-accent-ink disabled:opacity-50">
            Set
          </button>
        </form>
        {value ? (
          <button
            type="button"
            onClick={() => pick(null)}
            className="mt-1 flex w-full items-center rounded-lg px-2.5 py-1.5 text-left text-sm text-muted outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent"
          >
            Remove due date
          </button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
