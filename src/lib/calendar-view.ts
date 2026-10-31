import type { NavMatch } from "@/lib/app-nav";

/** The Calendar page's two views, shown as tabs (DES-13). Each keeps its own path, so old links still work. */
export type CalendarView = "agenda" | "month";

export const calendarViews: Record<CalendarView, { href: string; label: string }> = {
  agenda: { href: "/events", label: "Agenda" },
  month: { href: "/events/calendar", label: "Month" },
};

/** Cookie that remembers the calendar view used last, so the Calendar links open it. */
export const CALENDAR_VIEW_COOKIE = "calendar-view";

/** The remembered view in a `document.cookie` string; the agenda when there's none. */
export function calendarViewFromCookies(cookies: string): CalendarView {
  const cookie = cookies.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${CALENDAR_VIEW_COOKIE}=`));
  return cookie?.slice(CALENDAR_VIEW_COOKIE.length + 1) === "month" ? "month" : "agenda";
}

/** The sidebar's and the phone bar's Calendar item: it opens the view used last and is active on both. */
export function calendarNavItem(view: CalendarView): NavMatch {
  return { href: calendarViews[view].href, match: ["/events"] };
}
