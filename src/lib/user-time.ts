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

/** The current time as a Date whose local fields show the wall clock in `timeZone`. */
export function wallClockNow(timeZone: string | null | undefined, now = new Date()) {
  if (!isValidTimeZone(timeZone)) return now;

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(now);
  const field = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);

  return new Date(
    field("year"),
    field("month") - 1,
    field("day"),
    field("hour"),
    field("minute"),
    field("second"),
    now.getMilliseconds(),
  );
}
