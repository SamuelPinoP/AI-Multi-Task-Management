/** The Chats hub (SIDE-02): the list's data and the pure helpers that sort, filter and label it. */

export type ChatAccessLevel = "OWNER" | "EDITOR" | "VIEWER";

export type ChatSummary = {
  projectId: string;
  name: string;
  color: string | null;
  accessLevel: ChatAccessLevel;
  /** People in the project, the owner included. */
  memberCount: number;
  /** Messages from others since the user last read this chat (SIDE-03). */
  unread: number;
  /** Other people with an account in the project; Home shows Team chat only when a chat has some (DES-11). */
  teammates: number;
  lastMessage: {
    /** "You" or the author's first name. */
    author: string;
    text: string;
    attachmentCount: number;
    /** ISO time, for sorting. */
    at: string;
    /** Formatted on the server in the user's time zone, so it matches after hydration. */
    timeLabel: string;
  } | null;
};

export type ChatFilter = "all" | "unread";

/** "1" while the desktop Chats page shows its list beside an open chat; the list hides by default (#324). */
export const CHATS_LIST_COOKIE = "chats-list-open";

/** Unread chats first, then the newest message; chats without messages last, by name. */
export function sortChatSummaries(chats: ChatSummary[]) {
  return [...chats].sort((a, b) => {
    const unread = Number(b.unread > 0) - Number(a.unread > 0);
    if (unread) return unread;
    if (a.lastMessage && b.lastMessage) return Date.parse(b.lastMessage.at) - Date.parse(a.lastMessage.at);
    if (a.lastMessage || b.lastMessage) return a.lastMessage ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * The chats a filter and a search keep; the search matches the project name and the last message.
 * `keepUnread` names chats the Unread filter keeps although they're read now (opened since the page loaded).
 */
export function filterChatSummaries(chats: ChatSummary[], filter: ChatFilter, query: string, keepUnread?: ReadonlySet<string>) {
  const needle = query.trim().toLowerCase();
  return chats.filter((chat) => {
    if (filter === "unread" && chat.unread === 0 && !keepUnread?.has(chat.projectId)) return false;
    if (!needle) return true;
    return chat.name.toLowerCase().includes(needle) || Boolean(chat.lastMessage?.text.toLowerCase().includes(needle));
  });
}

/** A row's second line: "Ana: Homepage copy is ready", "You sent 2 files" or "No messages yet". */
export function chatPreview(chat: ChatSummary) {
  const last = chat.lastMessage;
  if (!last) return "No messages yet";
  if (last.text) return `${last.author}: ${last.text}`;
  return `${last.author} sent ${last.attachmentCount} file${last.attachmentCount === 1 ? "" : "s"}`;
}

/** People with an account in the project besides the user: the owner and members who signed up (DES-11). */
export function teammateCount(project: { userId: string; members: { userId: string | null }[] }, userId: string) {
  const others = new Set(project.members.flatMap((member) => (member.userId && member.userId !== userId ? [member.userId] : [])));
  if (project.userId !== userId) others.add(project.userId);
  return others.size;
}

/** Badge text: more than 99 reads "99+". */
export function formatUnreadCount(count: number) {
  return count > 99 ? "99+" : String(count);
}

/**
 * A message time for the list, in `timeZone` (the runtime's own without one):
 * the time today, "Yesterday", the weekday within a week, then the date, with
 * the year only when it isn't this year.
 */
export function formatChatTime(at: Date, now: Date, timeZone: string | null) {
  const zone = timeZone ?? undefined;
  const dayParts = (date: Date) => {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(date);
    const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((item) => item.type === type)?.value);
    return { year: part("year"), day: Date.UTC(part("year"), part("month") - 1, part("day")) / 86_400_000 };
  };
  const then = dayParts(at);
  const today = dayParts(now);
  const daysAgo = today.day - then.day;

  if (daysAgo <= 0) return new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit" }).format(at);
  if (daysAgo === 1) return "Yesterday";
  if (daysAgo < 7) return new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "short" }).format(at);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    month: "short",
    day: "numeric",
    year: then.year === today.year ? undefined : "numeric",
  }).format(at);
}
