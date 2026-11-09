const palette = ["var(--project-1)", "var(--project-2)", "var(--project-3)", "var(--project-4)"];

/** A stable color from the project palette for an id (projects without a color, avatars). */
export function paletteColor(id: string) {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return palette[hash % palette.length];
}

/**
 * Avatar colors (#386, #387): darker than the project palette, so white
 * initials on any of them pass WCAG AA (each is at least 5:1 against white;
 * the project palette's teal and amber aren't).
 */
export const AVATAR_COLORS = ["#0a6f68", "#9c5300", "#b3361f", "#475569", "#1d4ed8", "#6d28d9", "#be185d", "#15803d"] as const;

/** A stable avatar color for a person's id. */
export function avatarColor(id: string) {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

/** The project's own color, or a stable palette color when it has none. */
export function projectColor(project: { id: string; color: string | null }) {
  return project.color || paletteColor(project.id);
}
