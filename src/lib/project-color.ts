const palette = ["var(--project-1)", "var(--project-2)", "var(--project-3)", "var(--project-4)"];

/** A stable color from the project palette for an id (projects without a color, avatars). */
export function paletteColor(id: string) {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return palette[hash % palette.length];
}

/** The project's own color, or a stable palette color when it has none. */
export function projectColor(project: { id: string; color: string | null }) {
  return project.color || paletteColor(project.id);
}
