import { useSyncExternalStore } from "react";
import { CALENDAR_VIEW_COOKIE, calendarViewFromCookies, type CalendarView } from "@/lib/calendar-view";

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Remembers the calendar view in use for a year, so the Calendar links open it next time (DES-13). */
export function rememberCalendarView(view: CalendarView) {
  document.cookie = `${CALENDAR_VIEW_COOKIE}=${view}; path=/; max-age=31536000; samesite=lax`;
  listeners.forEach((listener) => listener());
}

/** The calendar view used last. The server can't see the cookie here, so it renders the agenda until hydration. */
export function useCalendarView() {
  return useSyncExternalStore(subscribe, () => calendarViewFromCookies(document.cookie), (): CalendarView => "agenda");
}
