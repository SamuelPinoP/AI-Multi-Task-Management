/**
 * Linked notes (SMART-05): `[[note title]]` links between notes, and turning
 * a selection in a note into a task.
 */

const LINK = /\[\[([^[\]\n]{1,200})\]\]/g;

/** The key two titles share when they name the same note: trimmed, case-insensitive. */
export function noteLinkKey(title: string) {
  return title.trim().replace(/\s+/g, " ").toLowerCase();
}

/** The distinct `[[titles]]` a note links to, in order, with their first spelling. */
export function extractNoteLinks(content: string | null | undefined) {
  const seen = new Set<string>();
  const titles: string[] = [];
  for (const match of (content ?? "").matchAll(LINK)) {
    const title = match[1].trim().replace(/\s+/g, " ");
    const key = noteLinkKey(title);
    if (!title || seen.has(key)) continue;
    seen.add(key);
    titles.push(title);
  }
  return titles;
}

/** Whether `content` links to the note titled `title`. */
export function linksTo(content: string | null | undefined, title: string) {
  const key = noteLinkKey(title);
  return Boolean(key) && extractNoteLinks(content).some((link) => noteLinkKey(link) === key);
}

/**
 * A task from selected note text: the first line (without a list marker or
 * checkbox) is the title; any further lines are the description.
 */
export function taskFromSelection(selection: string) {
  const lines = selection
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const clean = (line: string) => line.replace(/^(?:[-*•]\s+|\d+[.)]\s+)?(?:\[[ xX]?\]\s*)?/, "").replace(/\[\[|\]\]/g, "").trim();
  const title = clean(lines[0] ?? "").slice(0, 200);
  const description = lines.slice(1).join("\n").trim();
  return { title, description: description || null };
}
