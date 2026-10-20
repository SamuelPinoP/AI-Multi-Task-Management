/**
 * Single-key shortcuts for the app shell (DES-06). "g" starts a two-key
 * "go to" sequence: g then t opens Tasks, g then h Home, and so on.
 */
export type ShortcutAction =
  | { type: "new-task" }
  | { type: "search" }
  | { type: "help" }
  | { type: "start-go" }
  | { type: "go"; href: string };

export const goTargets: Record<string, { href: string; label: string }> = {
  h: { href: "/", label: "Home" },
  d: { href: "/today", label: "My day" },
  t: { href: "/tasks", label: "Tasks" },
  e: { href: "/events", label: "Events" },
  c: { href: "/events/calendar", label: "Calendar" },
  n: { href: "/notes", label: "Notes" },
  b: { href: "/board", label: "Boards" },
  p: { href: "/projects", label: "Projects" },
};

/** What a key press means, given whether "g" was just pressed. Returns null for keys that do nothing. */
export function resolveShortcut(key: string, goPending: boolean): ShortcutAction | null {
  const lower = key.toLowerCase();
  if (goPending) {
    const target = goTargets[lower];
    return target ? { type: "go", href: target.href } : null;
  }
  if (key === "?") return { type: "help" };
  if (key === "/") return { type: "search" };
  if (lower === "n") return { type: "new-task" };
  if (lower === "g") return { type: "start-go" };
  return null;
}

/** Shortcuts never fire while the user types in a field. */
export function isTypingTarget(target: EventTarget | null) {
  if (!target || typeof (target as Element).closest !== "function") return false;
  const element = target as HTMLElement;
  return Boolean(element.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']"));
}
