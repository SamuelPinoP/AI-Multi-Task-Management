"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Ref } from "react";
import { uiButtonClass } from "@/components/ui";
import { cn } from "@/lib/cn";

export type WeekStripDay = {
  key: string;
  /** "S", "M", ... */
  letter: string;
  date: number;
  /** The button's full name: "Tuesday, November 3, 2026, today, 2 items". */
  label: string;
  /** Before today or after the agenda's last day: nothing to jump to. */
  disabled: boolean;
  /** Up to three: filled for events, rings for tasks, in their projects' colors. */
  dots: { id: string; color: string; filled: boolean }[];
};

/**
 * The Agenda's week strip on phones and tablets (DES-17, like Todoist's
 * Upcoming): seven days with a dot per item. Tapping a day jumps the agenda
 * to it, and the page moves the selection as the agenda scrolls. Sticks to
 * the top of the page while the agenda scrolls under it.
 */
export function WeekStrip({
  ref,
  title,
  days,
  selectedKey,
  todayKey,
  canGoBack,
  canGoOn,
  onPick,
  onPreviousWeek,
  onNextWeek,
  onToday,
}: {
  ref?: Ref<HTMLDivElement>;
  /** The selected day's month, "November 2026". */
  title: string;
  days: WeekStripDay[];
  selectedKey: string;
  todayKey: string;
  canGoBack: boolean;
  canGoOn: boolean;
  onPick: (key: string) => void;
  onPreviousWeek: () => void;
  onNextWeek: () => void;
  onToday: () => void;
}) {
  return (
    <div ref={ref} className="sticky top-0 z-10 -mx-4 border-b border-line bg-canvas/95 px-4 pb-2 pt-1 backdrop-blur sm:-mx-6 sm:px-6 lg:hidden">
      <div className="flex items-center gap-1">
        <h2 className="mr-auto min-w-0 truncate text-base font-semibold">{title}</h2>
        <button type="button" onClick={onToday} className={cn(uiButtonClass, "rounded-full px-3 py-1.5")}>
          Today
        </button>
        <button
          type="button"
          onClick={onPreviousWeek}
          disabled={!canGoBack}
          aria-label="Previous week"
          className="grid h-11 w-11 place-items-center rounded-lg text-muted hover:bg-surface-hover hover:text-ink disabled:pointer-events-none disabled:opacity-40"
        >
          <ChevronLeft aria-hidden="true" className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={onNextWeek}
          disabled={!canGoOn}
          aria-label="Next week"
          className="grid h-11 w-11 place-items-center rounded-lg text-muted hover:bg-surface-hover hover:text-ink disabled:pointer-events-none disabled:opacity-40"
        >
          <ChevronRight aria-hidden="true" className="h-5 w-5" />
        </button>
      </div>
      {/* The weekday letters sit outside the buttons, so each button's visible text, its date, is part of its name. */}
      <div aria-hidden="true" className="grid grid-cols-7 text-center text-2xs font-semibold text-muted">
        {days.map((day) => (
          <span key={day.key}>{day.letter}</span>
        ))}
      </div>
      <div role="group" aria-label="Days of the week" className="grid grid-cols-7">
        {days.map((day) => {
          const selected = day.key === selectedKey;
          const today = day.key === todayKey;
          return (
            <button
              key={day.key}
              type="button"
              onClick={() => onPick(day.key)}
              disabled={day.disabled}
              aria-pressed={selected}
              aria-label={day.label}
              className="grid content-start justify-items-center gap-1 rounded-lg py-1 outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-45"
            >
              <span
                className={cn(
                  "grid h-9 w-9 place-items-center rounded-full text-sm tabular-nums",
                  selected ? "bg-accent font-semibold text-accent-ink" : today ? "bg-accent-soft font-semibold text-accent" : "text-ink",
                )}
              >
                {day.date}
              </span>
              <span aria-hidden="true" className="flex h-1.5 gap-0.5">
                {day.dots.map((dot) => (
                  <span
                    key={dot.id}
                    className="h-1.5 w-1.5 rounded-full border-[1.5px]"
                    style={{ borderColor: dot.color, backgroundColor: dot.filled ? dot.color : "transparent" }}
                  />
                ))}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
