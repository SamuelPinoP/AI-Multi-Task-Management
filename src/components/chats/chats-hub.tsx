"use client";

/**
 * The Chats hub (SIDE-02): the list on the left, the open chat on the right.
 * On phones the list and the chat are separate screens. On desktop an open
 * chat gets the whole width; its Chats button shows the list beside it again,
 * and that choice is remembered (#324).
 *
 * Since #387 the list has two sections, project chats first, then direct
 * messages, with All, Unread, People and Projects chips. The search finds
 * people, everyone in your projects whether or not you've written to them,
 * or projects under the Projects chip.
 */

import {
  ArrowLeft,
  CheckCheck,
  LayoutDashboard,
  MessagesSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Paperclip,
  Search,
  SquareKanban,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { PersonAvatar } from "@/components/person-avatar";
import { ProjectChatWorkspace } from "@/components/project-chat-workspace";
import { uiButtonClass } from "@/components/ui";
import { toast } from "@/components/ui/toaster";
import {
  CHATS_LIST_COOKIE,
  chatListView,
  chatPreview,
  directChatKey,
  directChatPreview,
  formatUnreadCount,
  projectChatKey,
  searchTarget,
  type ChatFilter,
  type ChatSummary,
  type DirectChatSummary,
  type PersonResult,
} from "@/lib/chats";
import type { OpenedProjectChat } from "@/lib/chats-data";
import { cn } from "@/lib/cn";
import { sharedProjectsLine, type Teammate } from "@/lib/direct-chats-core";
import type { OpenedDirectChat } from "@/lib/direct-chats";
import { projectColor } from "@/lib/project-color";
import { notifyWorkspaceChanged } from "@/lib/workspace-events";

export type SelectedChat = { kind: "project"; chat: OpenedProjectChat } | { kind: "person"; chat: OpenedDirectChat };

const FILTERS: { value: ChatFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
  { value: "people", label: "People" },
  { value: "projects", label: "Projects" },
];

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

const rowClass = (selected: boolean) =>
  cn(
    "flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-surface-hover",
    selected && "bg-surface shadow-[0_0_0_1px_var(--line)] hover:bg-surface",
  );

function UnreadBadge({ count }: { count: number }) {
  return (
    <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-accent px-1.5 font-mono text-2xs font-bold tabular-nums text-accent-ink">
      {formatUnreadCount(count)}
      <span className="sr-only"> unread message{count === 1 ? "" : "s"}</span>
    </span>
  );
}

/** The two lines beside a tile or an avatar: the name and time, then the preview and the unread count. */
function RowText({ name, time, preview, unread, attachment }: { name: string; time?: string; preview: string; unread: number; attachment?: boolean }) {
  const hasUnread = unread > 0;
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="flex items-baseline gap-2">
        <span className={cn("min-w-0 flex-1 truncate text-sm", hasUnread ? "font-bold" : "font-semibold")}>{name}</span>
        {time ? <span className={cn("shrink-0 text-xs", hasUnread ? "font-bold text-accent" : "text-muted")}>{time}</span> : null}
      </span>
      <span className="flex items-center gap-1.5">
        {attachment ? <Paperclip aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-muted" /> : null}
        <span className={cn("min-w-0 flex-1 truncate text-[0.8125rem]", hasUnread ? "text-ink" : "text-muted")}>{preview}</span>
        {hasUnread ? <UnreadBadge count={unread} /> : null}
      </span>
    </span>
  );
}

/**
 * A project's chat: a square tile tinted with the project's color, its letter in
 * the text color, so it reads in both themes whatever color the project has.
 * Its visible text is its accessible name.
 */
function ProjectChatRow({ chat, selected }: { chat: ChatSummary; selected: boolean }) {
  return (
    <Link href={`/chats?project=${chat.projectId}`} scroll={false} aria-current={selected ? "true" : undefined} className={rowClass(selected)}>
      <span
        aria-hidden="true"
        className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border text-base font-bold text-ink"
        style={{
          backgroundColor: `color-mix(in srgb, ${projectColor({ id: chat.projectId, color: chat.color })} 22%, var(--surface))`,
          borderColor: `color-mix(in srgb, ${projectColor({ id: chat.projectId, color: chat.color })} 45%, transparent)`,
        }}
      >
        {chat.name.trim().charAt(0).toUpperCase()}
      </span>
      <RowText
        name={chat.name}
        time={chat.lastMessage?.timeLabel}
        preview={chatPreview(chat)}
        unread={chat.unread}
        attachment={Boolean(chat.lastMessage?.attachmentCount)}
      />
    </Link>
  );
}

/** A person: your direct chat with them, or, in a search, someone from your projects to write to. */
function PersonRow({ personId, name, chat, projects, selected }: { personId: string; name: string; chat: DirectChatSummary | null; projects: string[]; selected: boolean }) {
  return (
    <Link href={`/chats?person=${personId}`} scroll={false} aria-current={selected ? "true" : undefined} className={rowClass(selected)}>
      <PersonAvatar id={personId} name={name} />
      <RowText
        name={name}
        time={chat?.lastMessage?.timeLabel}
        preview={chat ? directChatPreview(chat) : sharedProjectsLine(projects)}
        unread={chat?.unread ?? 0}
      />
    </Link>
  );
}

function SectionHeading({ id, children }: { id: string; children: string }) {
  return (
    <h2 id={id} className="px-3 pb-1 pt-3 text-2xs font-bold uppercase tracking-wider text-muted">
      {children}
    </h2>
  );
}

export function ChatsHub({
  chats,
  directs,
  teammates,
  selected,
  currentUser,
  initialListOpen,
}: {
  chats: ChatSummary[];
  directs: DirectChatSummary[];
  /** Everyone you share a project with, for the people search. */
  teammates: Teammate[];
  selected: SelectedChat | null;
  currentUser: { name: string | null; email: string };
  /** Whether the list shows beside an open chat on desktop, from the CHATS_LIST_COOKIE. */
  initialListOpen: boolean;
}) {
  const router = useRouter();
  const [listOpen, setListOpen] = useState(initialListOpen);
  const [filter, setFilter] = useState<ChatFilter>("all");
  const [query, setQuery] = useState("");
  const [markingAll, setMarkingAll] = useState(false);
  // The order from when the page loaded, so a chat doesn't jump away once it's read; a reload re-sorts.
  const [loadOrder] = useState(
    () => new Map([...chats.map((chat, index) => [projectChatKey(chat.projectId), index] as const), ...directs.map((chat, index) => [directChatKey(chat.personId), index] as const)]),
  );
  // Likewise, a chat that was unread stays under "Unread" after it's opened.
  const [unreadAtLoad] = useState(
    () => new Set([...chats.filter((chat) => chat.unread > 0).map((chat) => projectChatKey(chat.projectId)), ...directs.filter((chat) => chat.unread > 0).map((chat) => directChatKey(chat.personId))]),
  );

  const byLoadOrder = (key: string) => loadOrder.get(key) ?? Number.MAX_SAFE_INTEGER;
  const orderedChats = [...chats].sort((a, b) => byLoadOrder(projectChatKey(a.projectId)) - byLoadOrder(projectChatKey(b.projectId)));
  const orderedDirects = [...directs].sort((a, b) => byLoadOrder(directChatKey(a.personId)) - byLoadOrder(directChatKey(b.personId)));
  const view = chatListView({ projects: orderedChats, directs: orderedDirects, teammates, filter, query, keepUnread: unreadAtLoad });
  const unreadChats = chats.filter((chat) => chat.unread > 0).length + directs.filter((chat) => chat.unread > 0).length;
  const searchLabel = searchTarget(filter) === "projects" ? "Search projects" : "Search people";
  const selectedKey = selected ? (selected.kind === "project" ? projectChatKey(selected.chat.id) : directChatKey(selected.chat.personId)) : null;
  const isSelected = (key: string) => key === selectedKey;

  // Opening a chat marked it read on the server; the sidebar fetches its counts again.
  useEffect(() => {
    if (selectedKey) notifyWorkspaceChanged();
  }, [selectedKey]);

  function toggleList() {
    const next = !listOpen;
    setListOpen(next);
    document.cookie = `${CHATS_LIST_COOKIE}=${next ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
  }

  async function markAllRead() {
    setMarkingAll(true);
    try {
      const response = await fetch("/api/chats/read", { method: "POST" });
      if (!response.ok) throw new Error();
      notifyWorkspaceChanged();
      router.refresh();
      toast.success("All chats marked as read");
    } catch {
      toast.error("Could not mark the chats as read. Try again.");
    } finally {
      setMarkingAll(false);
    }
  }

  const needle = query.trim();
  let list: ReactNode;
  if (view.kind === "people") {
    list = view.people.length ? (
      <ul aria-label="People" className="flex flex-col gap-1">
        {view.people.map((person: PersonResult) => (
          <li key={person.personId} className="min-w-0">
            <PersonRow {...person} selected={isSelected(directChatKey(person.personId))} />
          </li>
        ))}
      </ul>
    ) : (
      <p className="px-3 py-8 text-center text-sm text-muted">{`No one in your projects matches “${needle}”.`}</p>
    );
  } else if (view.kind === "projects") {
    list = view.projects.length ? (
      <ul aria-label="Project chats" className="flex flex-col gap-1">
        {view.projects.map((chat) => (
          <li key={chat.projectId} className="min-w-0">
            <ProjectChatRow chat={chat} selected={isSelected(projectChatKey(chat.projectId))} />
          </li>
        ))}
      </ul>
    ) : (
      <p className="px-3 py-8 text-center text-sm text-muted">{`No projects match “${needle}”.`}</p>
    );
  } else {
    const projects = view.projects ?? [];
    const people = view.people ?? [];
    if (projects.length === 0 && people.length === 0) {
      list =
        filter === "unread" ? (
          <p className="px-3 py-8 text-center text-sm text-muted">You&apos;re all caught up.</p>
        ) : filter === "people" ? (
          <p className="px-3 py-8 text-center text-sm text-muted">Search for anyone in your projects to write to them.</p>
        ) : (
          <div className="px-3 py-8 text-center text-sm text-muted">
            <p>Each project has a team chat. Create a project to start one.</p>
            <Link href="/projects" className="mt-2 inline-block font-semibold text-accent hover:underline">
              Go to Projects
            </Link>
          </div>
        );
    } else {
      list = (
        <>
          {projects.length ? (
            <section aria-labelledby="chats-projects-heading">
              <SectionHeading id="chats-projects-heading">Projects</SectionHeading>
              <ul aria-label="Project chats" className="flex flex-col gap-1">
                {projects.map((chat) => (
                  <li key={chat.projectId} className="min-w-0">
                    <ProjectChatRow chat={chat} selected={isSelected(projectChatKey(chat.projectId))} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {people.length ? (
            <section aria-labelledby="chats-people-heading">
              <SectionHeading id="chats-people-heading">Direct messages</SectionHeading>
              <ul aria-label="Direct messages" className="flex flex-col gap-1">
                {people.map((chat) => (
                  <li key={chat.personId} className="min-w-0">
                    <PersonRow personId={chat.personId} name={chat.name} chat={chat} projects={chat.projects} selected={isSelected(directChatKey(chat.personId))} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      );
    }
  }

  return (
    <div className="flex h-full min-h-0">
      {/* Phones show the list or the chat. On desktop the list stays beside the chat only while it's open. */}
      <section
        id="chat-list"
        aria-labelledby="chats-heading"
        className={cn(
          "min-h-0 w-full flex-col bg-canvas lg:w-[22.5rem] lg:shrink-0 lg:border-r lg:border-line",
          selected ? "hidden" : "flex",
          selected && !listOpen ? "lg:hidden" : "lg:flex",
        )}
      >
        <div className="grid gap-3 px-4 pb-3 pt-5">
          <div className="flex items-center gap-3">
            <h1 id="chats-heading" className="min-w-0 flex-1 text-title">Chats</h1>
            <button
              type="button"
              onClick={() => void markAllRead()}
              disabled={!unreadChats || markingAll}
              className={cn(uiButtonClass, "gap-1.5 px-2.5 py-1.5 text-xs disabled:opacity-60")}
            >
              <CheckCheck aria-hidden="true" className="h-3.5 w-3.5" />
              Mark all read
            </button>
          </div>
          <label className="relative block">
            <span className="sr-only">{searchLabel}</span>
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={searchLabel}
              className="w-full rounded-lg border border-line bg-surface py-2 pl-9 pr-3 text-sm text-ink outline-none transition-colors placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/25"
            />
          </label>
          <div role="group" aria-label="Show" className="flex flex-wrap gap-1.5">
            {FILTERS.map((item) => (
              <button
                key={item.value}
                type="button"
                aria-pressed={filter === item.value}
                onClick={() => setFilter(item.value)}
                className={cn(
                  "rounded-full border px-3 py-1 text-[0.8125rem] font-semibold transition-colors",
                  filter === item.value ? "border-accent bg-accent-soft text-accent" : "border-line bg-surface text-muted hover:text-ink",
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-4">{list}</div>
      </section>

      <section aria-label="Conversation" className={cn("min-w-0 flex-1 flex-col bg-surface lg:flex", selected ? "flex" : "hidden")}>
        {selected ? (
          <>
            {/* The page's heading lives in the list; while the list is hidden, screen readers still get it here. */}
            <h1 className={cn("sr-only", listOpen && "lg:hidden")}>Chats</h1>
            {/* One row on phones: back, name, and the links as icons (their words come back from sm). */}
            <div className="flex items-center gap-2 border-b border-line px-2 py-2 sm:gap-3 sm:px-5 sm:py-3">
              <Link
                href="/chats"
                scroll={false}
                aria-label="All chats"
                title="All chats"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface-hover hover:text-ink lg:hidden"
              >
                <ArrowLeft aria-hidden="true" className="h-5 w-5" />
              </Link>
              {/* Desktop: shows or hides the list beside the chat, with the count of chats that have new messages. */}
              <button
                type="button"
                onClick={toggleList}
                aria-expanded={listOpen}
                aria-controls="chat-list"
                aria-label={unreadChats ? `Chats, ${unreadChats} with new messages` : undefined}
                title={listOpen ? "Hide the chat list" : "Show the chat list"}
                className={cn(uiButtonClass, "hidden shrink-0 gap-1.5 px-2.5 py-1.5 text-xs lg:inline-flex", listOpen && "bg-surface-hover")}
              >
                {listOpen ? (
                  <PanelLeftClose aria-hidden="true" className="h-4 w-4 text-muted" />
                ) : (
                  <PanelLeftOpen aria-hidden="true" className="h-4 w-4 text-muted" />
                )}
                Chats
                {/* The space keeps the visible text "Chats 1", part of the label, as the sidebar's badge does. */}
                {unreadChats ? " " : null}
                {unreadChats ? (
                  <span
                    aria-hidden="true"
                    className="inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-accent px-1.5 font-mono text-2xs font-bold tabular-nums text-accent-ink"
                  >
                    {formatUnreadCount(unreadChats)}
                  </span>
                ) : null}
              </button>
              <span aria-hidden="true" className="hidden h-6 w-px shrink-0 bg-line lg:block" />
              {selected.kind === "project" ? (
                <>
                  <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded" style={{ backgroundColor: projectColor({ id: selected.chat.id, color: selected.chat.color }) }} />
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-base font-bold">{selected.chat.name}</h2>
                    <p className="truncate text-xs text-muted">{plural(selected.chat.memberCount, "member")}</p>
                  </div>
                  <div className="flex shrink-0 gap-1.5 sm:gap-2">
                    <Link href={`/projects/${selected.chat.id}/board`} className={cn(uiButtonClass, "gap-1.5 p-2 text-xs sm:px-2.5 sm:py-1.5")}>
                      <SquareKanban aria-hidden="true" className="h-4 w-4 text-muted sm:h-3.5 sm:w-3.5" />
                      <span className="sr-only sm:not-sr-only">Board</span>
                    </Link>
                    <Link href={`/projects/${selected.chat.id}`} className={cn(uiButtonClass, "gap-1.5 p-2 text-xs sm:px-2.5 sm:py-1.5")}>
                      <LayoutDashboard aria-hidden="true" className="h-4 w-4 text-muted sm:h-3.5 sm:w-3.5" />
                      <span className="sr-only sm:not-sr-only">Open project</span>
                    </Link>
                  </div>
                </>
              ) : (
                <>
                  <PersonAvatar id={selected.chat.personId} name={selected.chat.name} className="h-8 w-8 text-xs" />
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-base font-bold">{selected.chat.name}</h2>
                    <p className="truncate text-xs text-muted">
                      {selected.chat.projects.length ? sharedProjectsLine(selected.chat.projects) : "No projects in common any more"}
                    </p>
                  </div>
                </>
              )}
            </div>
            {/* The pane has its own header and edges, so the chat inside it goes without a card frame. */}
            <div className="flex min-h-0 flex-1 flex-col">
              {selected.kind === "project" ? (
                <ProjectChatWorkspace
                  key={selectedKey}
                  framed={false}
                  projectId={selected.chat.id}
                  currentUser={currentUser}
                  attachmentsDisabledMessage={selected.chat.attachmentsDisabledMessage}
                  newSince={selected.chat.newSince}
                  initialComments={selected.chat.initialComments}
                />
              ) : (
                <ProjectChatWorkspace
                  key={selectedKey}
                  framed={false}
                  apiBase={`/api/direct-chats/${selected.chat.personId}`}
                  allowAttachments={false}
                  placeholder={`Message ${selected.chat.name.split(" ")[0]}`}
                  composerNotice={selected.chat.canSend ? undefined : "You no longer share a project, so you can't send new messages here."}
                  currentUser={currentUser}
                  newSince={selected.chat.newSince}
                  initialComments={selected.chat.initialComments}
                />
              )}
            </div>
          </>
        ) : (
          <div className="m-auto grid max-w-xs justify-items-center gap-2 p-6 text-center">
            <span aria-hidden="true" className="grid h-11 w-11 place-items-center rounded-xl bg-accent-soft text-accent">
              <MessagesSquare className="h-5 w-5" />
            </span>
            <p className="font-bold">Pick a chat</p>
            <p className="text-sm text-muted">Pick a chat to read or reply.</p>
          </div>
        )}
      </section>
    </div>
  );
}
