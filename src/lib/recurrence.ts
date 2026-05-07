import { Recurrence } from "@prisma/client";

export const RECURRENCE_VALUES = [
  "NONE",
  "DAILY",
  "WEEKLY",
  "BIWEEKLY",
  "MONTHLY",
] as const;

export type RecurrenceValue = (typeof RECURRENCE_VALUES)[number];

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
