import { Recurrence } from "@prisma/client";

export const RECURRENCE_VALUES = ["NONE", "DAILY", "WEEKLY", "BIWEEKLY", "MONTHLY"] as const;
export type RecurrenceValue = (typeof RECURRENCE_VALUES)[number];

export type EventLike = {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  startTime: string | null;
  endTime: string | null;
  recurrence?: Recurrence | null;
  recurrenceAnchorDate?: string | null;
  recurrenceWeekday?: number | null;
  recurrenceMonthDay?: number | null;
};

export function isValidRecurrence(value: unknown): value is Recurrence {
  return typeof value === "string" && RECURRENCE_VALUES.includes(value as RecurrenceValue);
}
export function normalizeRecurrence(value: unknown): Recurrence {
  return isValidRecurrence(value) ? value : Recurrence.NONE;
}
export function formatRecurrenceLabel(value: unknown) {
  const recurrence = normalizeRecurrence(value);
  if (recurrence === Recurrence.NONE) return "No";
  if (recurrence === Recurrence.BIWEEKLY) return "every 2 weeks";
  return recurrence.toLowerCase();
}

export function eventOccursOnDay(event: EventLike, day: Date) {
  const recurrence = normalizeRecurrence(event.recurrence);
  const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate());

  if (recurrence === Recurrence.NONE) {
    if (!event.startTime) return false;
    const start = new Date(event.startTime);
    return start.getFullYear() === dayStart.getFullYear() && start.getMonth() === dayStart.getMonth() && start.getDate() === dayStart.getDate();
  }

  const anchor = event.recurrenceAnchorDate ? new Date(event.recurrenceAnchorDate) : (event.startTime ? new Date(event.startTime) : null);
  if (!anchor) return false;

  const anchorDay = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  const diffDays = Math.floor((dayStart.getTime() - anchorDay.getTime()) / 86400000);
  if (diffDays < 0) return false;

  if (recurrence === Recurrence.DAILY) return true;
  if (recurrence === Recurrence.WEEKLY) return dayStart.getDay() === (event.recurrenceWeekday ?? anchorDay.getDay());
  if (recurrence === Recurrence.BIWEEKLY) return dayStart.getDay() === (event.recurrenceWeekday ?? anchorDay.getDay()) && Math.floor(diffDays / 7) % 2 === 0;
  if (recurrence === Recurrence.MONTHLY) return dayStart.getDate() === (event.recurrenceMonthDay ?? anchorDay.getDate());

  return false;
}
