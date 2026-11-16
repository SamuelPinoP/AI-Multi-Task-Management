// How much of today's AI allowance is left (#307). Days run midnight to
// midnight Pacific time, when Gemini resets its daily quotas ("RPD quotas reset
// at midnight Pacific time", Gemini API rate limits), so the app-wide cap and
// Google's own limit count the same day.
import type { AgentCaps } from "@/lib/ai/config";
import { dayKeyInZone } from "@/lib/user-time";

export const QUOTA_TIME_ZONE = "America/Los_Angeles";

export type AllowanceCount = { used: number; limit: number; remaining: number };

export type Allowance = {
  user: AllowanceCount;
  app: AllowanceCount;
  /** When both counts start again from zero (ISO 8601). */
  resetsAt: string;
};

/** Minutes `timeZone` is ahead of UTC at `instant` (negative west of Greenwich). */
function offsetMinutes(timeZone: string, instant: Date) {
  const name =
    new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
      .formatToParts(instant)
      .find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(name);
  return match ? (match[1] === "+" ? 1 : -1) * (Number(match[2]) * 60 + Number(match[3])) : 0;
}

/** The instant `dayKey` ("2026-11-16") starts in `timeZone`. */
function startOfDayIn(timeZone: string, dayKey: string) {
  const [year, month, day] = dayKey.split("-").map(Number);
  const utcMidnight = Date.UTC(year, month - 1, day);
  // A first guess with the offset at UTC midnight, then again with the offset in force at the guess,
  // which is right on the days the clocks change too.
  const guess = utcMidnight - offsetMinutes(timeZone, new Date(utcMidnight)) * 60_000;
  return new Date(utcMidnight - offsetMinutes(timeZone, new Date(guess)) * 60_000);
}

/** When the quota day that `now` falls in started. */
export function quotaDayStart(now: Date, timeZone = QUOTA_TIME_ZONE) {
  return startOfDayIn(timeZone, dayKeyInZone(timeZone, now));
}

/** When the next quota day starts. */
export function nextQuotaReset(now: Date, timeZone = QUOTA_TIME_ZONE) {
  const [year, month, day] = dayKeyInZone(timeZone, now).split("-").map(Number);
  return startOfDayIn(timeZone, new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10));
}

function count(used: number, limit: number): AllowanceCount {
  return { used, limit, remaining: Math.max(0, limit - used) };
}

export function allowanceFor(used: { user: number; app: number }, caps: AgentCaps, now: Date): Allowance {
  return {
    user: count(used.user, caps.userDailyRequests),
    app: count(used.app, caps.appDailyRequests),
    resetsAt: nextQuotaReset(now).toISOString(),
  };
}

/** Which cap stops a new message, if any; the person's own is reported first. */
export function exhaustedCap(allowance: Allowance): "user" | "app" | null {
  if (allowance.user.remaining <= 0) return "user";
  if (allowance.app.remaining <= 0) return "app";
  return null;
}

/** "about 7 hours", for messages about the reset. */
export function untilReset(allowance: Allowance, now: Date) {
  const hours = Math.max(1, Math.ceil((new Date(allowance.resetsAt).getTime() - now.getTime()) / 3_600_000));
  return hours === 1 ? "about an hour" : `about ${hours} hours`;
}
