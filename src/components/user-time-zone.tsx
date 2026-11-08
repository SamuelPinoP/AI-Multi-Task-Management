"use client";

import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import { dayKeyInZone } from "@/lib/user-time";

/** The reader's time zone as the server knows it: the `tz` cookie, or null until a first visit sets it. */
const ServerTimeZoneContext = createContext<string | null>(null);

export function UserTimeZoneProvider({ timeZone, children }: { timeZone: string | null; children: ReactNode }) {
  return <ServerTimeZoneContext.Provider value={timeZone}>{children}</ServerTimeZoneContext.Provider>;
}

// The browser's zone doesn't change while a page is open, so there's nothing to subscribe to.
const subscribe = () => () => {};
const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || null;

/**
 * The time zone to show times in, for `formatInstant` and `dayKeyInZone` (#381). While React
 * hydrates a page, it's the zone the server rendered with, so the texts match and React keeps the
 * server's HTML. Right after, it's the browser's own zone, in case the cookie was missing (a first
 * visit) or out of date (the computer moved to another zone).
 */
export function useUserTimeZone() {
  const serverTimeZone = useContext(ServerTimeZoneContext);
  return useSyncExternalStore(subscribe, browserTimeZone, () => serverTimeZone);
}

/**
 * Today in the reader's zone, as "2026-11-08". Like `useUserTimeZone`, it can change right after
 * the page hydrates: a calendar that starts on today should move along while it's still there.
 */
export function useTodayKey() {
  return dayKeyInZone(useUserTimeZone());
}
