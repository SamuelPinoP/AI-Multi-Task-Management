// The owner-only Users page: how its numbers and words are worked out. It shows dates and counts,
// never what people wrote. Kept free of server-only imports so it can be unit tested with plain Node.

import { SESSION_IDLE_DAYS } from "@/lib/session-lifetime";
import { dayKeyInZone, formatInstant } from "@/lib/user-time";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Accounts this young get a "New" badge. */
export const NEW_ACCOUNT_DAYS = 7;
/** "Active this week" counts accounts last active within this many days. */
export const ACTIVE_RECENTLY_DAYS = 7;

export type SignInMethodName = "PASSWORD" | "GOOGLE" | "GUEST";

export type ActivityActionName =
  | "CREATED_NOTE"
  | "CREATED_TASK"
  | "COMPLETED_TASK"
  | "CREATED_EVENT"
  | "CREATED_PROJECT"
  | "COMMENTED"
  | "DELETED_ITEM"
  | "RESTORED_ITEM";

export type MadeCounts = { tasks: number; notes: number; events: number; projects: number; messages: number };

/** The latest of the moments that show someone used the app, or null when there are none. */
export function latestOf(...moments: Array<Date | null | undefined>) {
  let latest: Date | null = null;
  for (const moment of moments) {
    if (moment && (!latest || moment > latest)) latest = moment;
  }
  return latest;
}

/**
 * When someone last used any of their sessions, judged from the sessions alone: one in use is renewed
 * to SESSION_IDLE_DAYS after its last use (#354), so its end, less that, is about when it was used.
 * For accounts from before `User.lastActiveAt` existed.
 */
export function sessionLastUsed(latestStart: Date | null | undefined, latestEnd: Date | null | undefined) {
  return latestOf(latestStart, latestEnd ? new Date(latestEnd.getTime() - SESSION_IDLE_DAYS * DAY_MS) : null);
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return `${count.toLocaleString("en-US")} ${count === 1 ? singular : pluralForm}`;
}

/** What someone made, biggest kinds first in a fixed order, leaving out the kinds they made none of. */
export function madeSummary(made: MadeCounts) {
  return [
    made.tasks ? plural(made.tasks, "task") : null,
    made.notes ? plural(made.notes, "note") : null,
    made.events ? plural(made.events, "event") : null,
    made.projects ? plural(made.projects, "project") : null,
    made.messages ? plural(made.messages, "chat message") : null,
  ].filter((part): part is string => part !== null);
}

/** How an account can sign in. */
export function signsInWith({ hasPassword, hasGoogle }: { hasPassword: boolean; hasGoogle: boolean }) {
  if (hasPassword && hasGoogle) return "Password and Google";
  if (hasGoogle) return "Google";
  if (hasPassword) return "Password";
  return "No way to sign in";
}

const SIGN_IN_LABELS: Record<SignInMethodName, string> = { PASSWORD: "Password", GOOGLE: "Google", GUEST: "Guest" };

/** One row of the sign-in history: "Password", or "Signed up with Google" for an account's first session. */
export function signInLabel(method: SignInMethodName, newAccount: boolean) {
  if (!newAccount) return SIGN_IN_LABELS[method];
  if (method === "GUEST") return "Started a guest workspace";
  return method === "GOOGLE" ? "Signed up with Google" : "Signed up with a password";
}

const ACTIVITY_LABELS: Record<ActivityActionName, { one: string; count: (n: number) => string }> = {
  CREATED_TASK: { one: "Created a task", count: (n) => `Created ${plural(n, "task")}` },
  COMPLETED_TASK: { one: "Completed a task", count: (n) => `Completed ${plural(n, "task")}` },
  CREATED_NOTE: { one: "Created a note", count: (n) => `Created ${plural(n, "note")}` },
  CREATED_EVENT: { one: "Created an event", count: (n) => `Created ${plural(n, "event")}` },
  CREATED_PROJECT: { one: "Created a project", count: (n) => `Created ${plural(n, "project")}` },
  COMMENTED: { one: "Wrote in a project chat", count: (n) => `Wrote ${plural(n, "project chat message")}` },
  DELETED_ITEM: { one: "Moved an item to Trash", count: (n) => `Moved ${plural(n, "item")} to Trash` },
  RESTORED_ITEM: { one: "Restored an item", count: (n) => `Restored ${plural(n, "item")}` },
};

/** An action from the activity log, without its title: "Created a task". */
export function activityLabel(action: ActivityActionName) {
  return ACTIVITY_LABELS[action].one;
}

/** Totals per kind of action, most frequent first: ["Created 19 tasks", "Completed 5 tasks"]. */
export function activityTotals(counts: Array<{ action: ActivityActionName; count: number }>) {
  return [...counts]
    .filter(({ count }) => count > 0)
    .sort((a, b) => b.count - a.count || a.action.localeCompare(b.action))
    .map(({ action, count }) => ACTIVITY_LABELS[action].count(count));
}

export function isNewAccount(signedUpAt: Date, now: Date) {
  return now.getTime() - signedUpAt.getTime() < NEW_ACCOUNT_DAYS * DAY_MS;
}

/** The figures above the list. */
export function usersSummary(users: Array<{ signedUpAt: Date; confirmedAt: Date | null; lastActiveAt: Date | null }>, now: Date) {
  const recently = now.getTime() - ACTIVE_RECENTLY_DAYS * DAY_MS;
  return {
    accounts: users.length,
    confirmed: users.filter((user) => user.confirmedAt).length,
    activeThisWeek: users.filter((user) => user.lastActiveAt && user.lastActiveAt.getTime() >= recently).length,
    newThisWeek: users.filter((user) => isNewAccount(user.signedUpAt, now)).length,
  };
}

/**
 * A moment as the reader thinks of it: "Today, 3:05 PM", "Yesterday, 9:12 AM", "Nov 3" or
 * "Nov 3, 2025", counting days in the reader's time zone.
 */
export function relativeDay(instant: Date, now: Date, timeZone: string | null | undefined) {
  const day = dayKeyInZone(timeZone, instant);
  const time = formatInstant(instant, timeZone, { hour: "numeric", minute: "2-digit" });
  if (day === dayKeyInZone(timeZone, now)) return `Today, ${time}`;
  if (day === dayKeyInZone(timeZone, new Date(now.getTime() - DAY_MS))) return `Yesterday, ${time}`;
  const sameYear = day.slice(0, 4) === dayKeyInZone(timeZone, now).slice(0, 4);
  return formatInstant(instant, timeZone, sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
}

/** A date and time in full, for a title or the sign-in history: "Nov 3, 2026, 3:05 PM". */
export function fullDateTime(instant: Date, timeZone: string | null | undefined) {
  return formatInstant(instant, timeZone, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}
