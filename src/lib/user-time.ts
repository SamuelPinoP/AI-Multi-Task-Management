/**
 * "Today" on the server, in the user's time zone (#125).
 *
 * The browser keeps its IANA time zone in the `tz` cookie (see
 * `TimeZoneCookie` in the root layout). Server pages that need "today" use a
 * wall-clock "now": a Date whose local fields are the user's wall-clock time.
 * The existing local-date helpers (getLocalDateOnly, eventWallTime,
 * toEventStorageTime, ...) then give the user's day boundaries, even though
 * Vercel runs in UTC. Without a valid cookie the real time is used, as before.
 */
export const TIME_ZONE_COOKIE = "tz";

export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** An instant (now by default) as a Date whose local fields show the wall clock in `timeZone`. */
export function toWallClock(timeZone: string | null | undefined, instant = new Date()) {
  if (!isValidTimeZone(timeZone)) return instant;

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const field = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);

  return new Date(
    field("year"),
    field("month") - 1,
    field("day"),
    field("hour"),
    field("minute"),
    field("second"),
    instant.getMilliseconds(),
  );
}

/** `timeZone` when it's a real zone, otherwise UTC: the same choice on the server and in the browser. */
function zoneOrUtc(timeZone: string | null | undefined) {
  return isValidTimeZone(timeZone) ? timeZone : "UTC";
}

/**
 * A moment in time as English text in `timeZone`, or in UTC without one (#381).
 * `toLocaleString()` uses the runtime's zone and language instead: UTC and English on the server,
 * the reader's own in the browser. The texts then differ, and React rebuilds the page it hydrates.
 */
export function formatInstant(
  value: Date | string,
  timeZone: string | null | undefined,
  options: Intl.DateTimeFormatOptions,
) {
  return new Intl.DateTimeFormat("en-US", { ...options, timeZone: zoneOrUtc(timeZone) }).format(new Date(value));
}

/** The calendar day in `timeZone` (UTC without one) at `instant`, as "2026-11-08". */
export function dayKeyInZone(timeZone: string | null | undefined, instant = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zoneOrUtc(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
