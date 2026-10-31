"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { CalendarSubscribe } from "@/components/calendar-subscribe";
import { uiPrimaryButtonClass } from "@/components/ui";
import { calendarViews, type CalendarView } from "@/lib/calendar-view";
import { cn } from "@/lib/cn";
import { rememberCalendarView } from "@/lib/use-calendar-view";

/**
 * The Calendar page's header with its Agenda and Month tabs (DES-13). Both views render it,
 * so switching tabs moves nothing but the view. The view on screen is remembered, so the
 * sidebar's Calendar item opens it next time.
 */
export function CalendarHeader({ active, summary, onNewEvent }: { active: CalendarView; summary: string; onNewEvent: () => void }) {
  useEffect(() => {
    // A link to one event (?event=, from search, Home or the month) opens it on the agenda; that isn't picking a view.
    if (!new URLSearchParams(window.location.search).has("event")) rememberCalendarView(active);
  }, [active]);

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-title">Calendar</h1>
          <p className="mt-0.5 text-sm text-muted">{summary}</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={onNewEvent} className={cn(uiPrimaryButtonClass, "px-3 py-1.5")}>
            <Plus aria-hidden="true" className="h-4 w-4" />
            New event
          </button>
          <CalendarSubscribe />
        </div>
      </header>

      <nav aria-label="Calendar views" className="flex gap-1 border-b border-line">
        {(Object.keys(calendarViews) as CalendarView[]).map((view) => (
          <Link
            key={view}
            href={calendarViews[view].href}
            onClick={() => rememberCalendarView(view)}
            aria-current={view === active ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 pb-2 pt-1 text-sm transition-colors",
              view === active ? "border-accent font-semibold text-ink" : "border-transparent text-muted hover:border-line hover:text-ink",
            )}
          >
            {calendarViews[view].label}
          </Link>
        ))}
      </nav>
    </>
  );
}
