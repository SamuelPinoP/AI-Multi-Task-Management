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
  m: { href: "/chats", label: "Chats" },
  t: { href: "/tasks", label: "Tasks" },
  // The Calendar's two tabs (DES-13) keep the keys of the old Events and Calendar items.
  e: { href: "/events", label: "Calendar: Agenda" },
  c: { href: "/events/calendar", label: "Calendar: Month" },
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

type ChatKeyPress = Pick<KeyboardEvent, "key" | "shiftKey" | "altKey" | "ctrlKey" | "metaKey" | "isComposing" | "keyCode">;

/**
 * Whether a key press in a chat message box sends the message (#303). Like most
 * chat apps, Enter sends and Shift+Enter starts a new line. On-screen keyboards
 * have no Shift, so on a touch screen Enter starts a new line and the Send button
 * sends. Ctrl+Enter and ⌘+Enter send everywhere.
 */
export function sendsChatMessage(press: ChatKeyPress, touchScreen: boolean) {
  // An Enter that picks a word in an input method (Japanese, Chinese, Korean…) only picks it.
  // Safari reports that press with isComposing already false, but with keyCode 229.
  if (press.key !== "Enter" || press.isComposing || press.keyCode === 229) return false;
  if (press.shiftKey || press.altKey) return false;
  return press.ctrlKey || press.metaKey || !touchScreen;
}
