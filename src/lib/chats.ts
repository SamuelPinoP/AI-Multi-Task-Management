/**
 * The Chats hub (SIDE-02): the list's data and the pure helpers that sort,
 * filter and label it. Since #387 it holds project chats and direct chats, in
 * two sections, Projects first.
 */

import { nameMatches, type Teammate } from "@/lib/direct-chats-core";

export type ChatSummary = {
  projectId: string;
  name: string;
  color: string | null;
  /** When the project's photo last changed (#403), or null without one: the list shows the letter tile then. */
  photoUpdatedAt: string | null;
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

/** A one-to-one chat with someone you share, or shared, a project with (#387). */
export type DirectChatSummary = {
  /** The other person's user id; the chat's address is /chats?person=<id>. */
  personId: string;
  name: string;
  unread: number;
  /** The projects you share now, by name; empty once you share none. */
  projects: string[];
  lastMessage: ChatSummary["lastMessage"];
};

/** The Chats list's chips (#387). */
export type ChatFilter = "all" | "unread" | "people" | "projects";

/** The search box looks for projects under the Projects chip and for people otherwise (#387). */
export function searchTarget(filter: ChatFilter): "people" | "projects" {
  return filter === "projects" ? "projects" : "people";
}

/** One person in a people search: your chat with them, or someone from your projects you haven't written to yet. */
export type PersonResult = { personId: string; name: string; projects: string[]; chat: DirectChatSummary | null };

/**
 * What the list shows. Without a search: the Projects and Direct messages
 * sections the chip keeps (null hides one). A search finds people (your chats
 * and everyone else in your projects) or, under Projects, project chats.
 */
export type ChatListView =
  | { kind: "sections"; projects: ChatSummary[] | null; people: DirectChatSummary[] | null }
  | { kind: "people"; people: PersonResult[] }
  | { kind: "projects"; projects: ChatSummary[] };

/** Keys for `keepUnread`: chats the Unread chip keeps although they're read now (opened since the page loaded). */
export const projectChatKey = (projectId: string) => `project:${projectId}`;
export const directChatKey = (personId: string) => `person:${personId}`;

/** Direct chats with unread messages first, then the newest. */
export function sortDirectChats(chats: DirectChatSummary[]) {
  return [...chats].sort((a, b) => {
    const unread = Number(b.unread > 0) - Number(a.unread > 0);
    if (unread) return unread;
    return Date.parse(b.lastMessage?.at ?? "0") - Date.parse(a.lastMessage?.at ?? "0");
  });
}

export function chatListView({
  projects,
  directs,
  teammates,
  filter,
  query,
  keepUnread,
}: {
  projects: ChatSummary[];
  directs: DirectChatSummary[];
  teammates: Teammate[];
  filter: ChatFilter;
  query: string;
  keepUnread?: ReadonlySet<string>;
}): ChatListView {
  const isUnread = (key: string, unread: number) => unread > 0 || Boolean(keepUnread?.has(key));
  const unreadOnly = filter === "unread";
  const shownProjects = unreadOnly ? projects.filter((chat) => isUnread(projectChatKey(chat.projectId), chat.unread)) : projects;
  const shownDirects = unreadOnly ? directs.filter((chat) => isUnread(directChatKey(chat.personId), chat.unread)) : directs;
  const needle = query.trim();

  if (!needle) {
    return {
      kind: "sections",
      projects: filter === "people" ? null : shownProjects,
      people: filter === "projects" ? null : shownDirects,
    };
  }
  if (searchTarget(filter) === "projects") {
    return { kind: "projects", projects: projects.filter((chat) => nameMatches(chat.name, needle)) };
  }

  const chats: PersonResult[] = shownDirects
    .filter((chat) => nameMatches(chat.name, needle))
    .map((chat) => ({ personId: chat.personId, name: chat.name, projects: chat.projects, chat }));
  // Under Unread a search stays within unread chats; otherwise it reaches everyone in your projects.
  const written = new Set(directs.map((chat) => chat.personId));
  const others: PersonResult[] = unreadOnly
    ? []
    : teammates
        .filter((person) => !written.has(person.id) && nameMatches(person.name, needle))
        .map((person) => ({ personId: person.id, name: person.name, projects: person.projects, chat: null }));
  return { kind: "people", people: [...chats, ...others] };
}

/** The width the desktop Chats list was dragged to, in rem (#416). */
export const CHATS_LIST_WIDTH_COOKIE = "chats-list-width";

/** "1" while the desktop Chats list is shrunk to its column of photos (#416). */
export const CHATS_LIST_COMPACT_COOKIE = "chats-list-compact";

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

/** A direct chat's second line: their message as is, yours after "You:" (#387). */
export function directChatPreview(chat: DirectChatSummary) {
  const last = chat.lastMessage;
  if (!last) return "No messages yet";
  return last.author === "You" ? `You: ${last.text}` : last.text;
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
