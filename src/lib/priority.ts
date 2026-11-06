/**
 * Task and project priorities (#361): Linear's five levels. The values match
 * `enum Priority` in prisma/schema.prisma; this file has no server imports so
 * pages, components and API routes can all share it.
 */

/** Most urgent first: the order lists and sorting use. */
export const PRIORITIES = ["URGENT", "HIGH", "MEDIUM", "LOW", "NONE"] as const;

export type Priority = (typeof PRIORITIES)[number];

/** The order pickers offer them in, as Linear does: no priority first, then most urgent. */
export const PRIORITY_MENU_ORDER: readonly Priority[] = ["NONE", "URGENT", "HIGH", "MEDIUM", "LOW"];

export const priorityLabels: Record<Priority, string> = {
  URGENT: "Urgent",
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
  NONE: "No priority",
};

/** Short labels for small badges; No priority shows no badge at all. */
export const priorityBadgeLabels: Record<Priority, string> = {
  URGENT: "Urgent",
  HIGH: "High",
  MEDIUM: "Med",
  LOW: "Low",
  NONE: "",
};

export function isPriority(value: unknown): value is Priority {
  return typeof value === "string" && (PRIORITIES as readonly string[]).includes(value);
}

/** 0 for Urgent up to 4 for No priority. */
export function priorityRank(priority: Priority) {
  return PRIORITIES.indexOf(priority);
}

/** Sorts most urgent first; No priority goes last. */
export function comparePriority(a: Priority, b: Priority) {
  return priorityRank(a) - priorityRank(b);
}

/** Urgent and High stand out in red; the rest stay quiet. */
export function isPressingPriority(priority: Priority) {
  return priority === "URGENT" || priority === "HIGH";
}
