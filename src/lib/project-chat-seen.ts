import { useMemo, useSyncExternalStore } from "react";

/**
 * When this browser last had each project chat open, so the sidebar can mark
 * chats with newer messages. Kept in localStorage: it is a per-browser hint,
 * not a read receipt.
 */
const CHAT_SEEN_KEY = "project-chat-seen";
const CHAT_SEEN_EVENT = "project-chat:seen";
const CHAT_SEEN_LIMIT = 50;

export type ChatSeen = Record<string, string>;

/**
 * Whether a chat has a message from someone else since this browser last opened it.
 * `lastChatAt` only covers recent messages (see getWorkspaceNav), so a chat never
 * opened here counts as new only while its latest message is recent.
 */
export function isChatUnread(lastChatAt: string | null, seenAt: string | undefined) {
  if (!lastChatAt) return false;
  const last = Date.parse(lastChatAt);
  if (Number.isNaN(last)) return false;
  const seen = seenAt ? Date.parse(seenAt) : Number.NaN;
  return Number.isNaN(seen) || last > seen;
}

export function parseChatSeen(raw: string | null): ChatSeen {
  try {
    const value: unknown = JSON.parse(raw ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  } catch {
    return {};
  }
}

/** Keeps the most recently seen chats, so the stored map stays small. */
export function pruneChatSeen(seen: ChatSeen, limit = CHAT_SEEN_LIMIT): ChatSeen {
  return Object.fromEntries(
    Object.entries(seen)
      .sort(([, a], [, b]) => b.localeCompare(a))
      .slice(0, limit),
  );
}

function readRaw() {
  try {
    return window.localStorage.getItem(CHAT_SEEN_KEY) ?? "{}";
  } catch {
    return "{}";
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHAT_SEEN_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHAT_SEEN_EVENT, onChange);
  };
}

/** Records that the user has seen a project's chat up to now. */
export function markChatSeen(projectId: string) {
  const seen = pruneChatSeen({ ...parseChatSeen(readRaw()), [projectId]: new Date().toISOString() });
  try {
    window.localStorage.setItem(CHAT_SEEN_KEY, JSON.stringify(seen));
  } catch {
    // Storage blocked: chats just won't be marked as seen.
  }
  window.dispatchEvent(new Event(CHAT_SEEN_EVENT));
}

/** The seen map; empty during server rendering and hydration. */
export function useChatSeen(): ChatSeen {
  const raw = useSyncExternalStore(subscribe, readRaw, () => "{}");
  return useMemo(() => parseChatSeen(raw), [raw]);
}
