/**
 * Task labels (#276): the color palette, the name rules and the filter. No
 * server imports, so pages, components and API routes all share it.
 *
 * A personal label (`projectId` null) goes on its owner's personal tasks; a
 * project label goes on that project's tasks.
 */

/** The palette labels pick from; the same eight colors as projects. */
export const LABEL_COLORS = [
  { value: "#0f9488", name: "Teal" },
  { value: "#2563eb", name: "Blue" },
  { value: "#7c3aed", name: "Violet" },
  { value: "#db2777", name: "Pink" },
  { value: "#e11d48", name: "Red" },
  { value: "#d97706", name: "Amber" },
  { value: "#65a30d", name: "Green" },
  { value: "#64748b", name: "Slate" },
] as const;

export const LABEL_NAME_MAX = 40;

/** How many labels one task can carry. */
export const LABELS_PER_TASK_MAX = 20;

export type Label = { id: string; name: string; color: string; projectId: string | null };

/** The trimmed name with inner spaces collapsed, or null when it's empty or too long. */
export function cleanLabelName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\s+/g, " ");
  return name && name.length <= LABEL_NAME_MAX ? name : null;
}

/** Names are unique per owner ignoring case: "Bug" and "bug" are the same label. */
export function labelNameKey(name: string) {
  return name.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

export function isLabelColor(value: unknown): value is string {
  return typeof value === "string" && LABEL_COLORS.some((color) => color.value === value.toLowerCase());
}

export function labelColorName(value: string) {
  return LABEL_COLORS.find((color) => color.value === value.toLowerCase())?.name ?? "Custom";
}

/** The color for a new label: the first palette color not in use yet, then round the palette again. */
export function nextLabelColor(usedColors: readonly string[]) {
  const used = new Set(usedColors.map((color) => color.toLowerCase()));
  const free = LABEL_COLORS.find((color) => !used.has(color.value));
  return (free ?? LABEL_COLORS[usedColors.length % LABEL_COLORS.length]).value;
}

/** A task matches when it has any of the chosen labels; choosing none matches every task. */
export function matchesLabelFilter(taskLabelIds: readonly string[], chosen: ReadonlySet<string>) {
  return chosen.size === 0 || taskLabelIds.some((id) => chosen.has(id));
}

/** A task's labels from the API's join rows, sorted by name. */
export function labelsOfTask(task: { labels?: { label: Label }[] }): Label[] {
  return (task.labels ?? []).map((row) => row.label).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

/** Sorts labels by name, ignoring case. */
export function sortLabels<T extends { name: string }>(labels: readonly T[]) {
  return [...labels].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}
