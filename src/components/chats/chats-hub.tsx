"use client";

/**
 * The Chats hub (SIDE-02): the list on the left, the open chat on the right.
 * On phones the list and the chat are separate screens. On desktop the list
 * always sits beside the open chat; its right edge drags to any width from
 * 240 to 480 px, and past 240 px it shrinks to a column of photos, like
 * Telegram Desktop (#416). The width is remembered.
 *
 * Since #387 the list has two sections, project chats first, then direct
 * messages, with All, Unread, People and Projects chips. The search finds
 * people, everyone in your projects whether or not you've written to them,
 * or projects under the Projects chip.
 */

import { ArrowLeft, CheckCheck, MessagesSquare, Paperclip, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ChatSearchButton, ChatSearchProvider } from "@/components/chats/chat-search";
import { ProjectChatMenu } from "@/components/chats/project-chat-menu";
import { PersonAvatar } from "@/components/person-avatar";
import { ProjectChatWorkspace } from "@/components/project-chat-workspace";
import { ProjectAvatar } from "@/components/projects/project-avatar";
import { ProjectPhotoButton } from "@/components/projects/project-photo-button";
import { uiButtonClass } from "@/components/ui";
import { ResizeHandle } from "@/components/ui/resize-handle";
import { toast } from "@/components/ui/toaster";
import { Tooltip, TooltipDetail } from "@/components/ui/tooltip";
import {
  CHATS_LIST_COMPACT_COOKIE,
  CHATS_LIST_WIDTH_COOKIE,
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
import { CHAT_LIST_LIMITS, savePanelCookies, shownWidth, type PanelSize } from "@/lib/panel-resize";
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
    // 56 px rows with 36 px photos (#416): a little smaller than before, like the heading, search and filters.
    "flex items-center gap-3 rounded-xl px-2.5 py-2 transition-colors hover:bg-surface-hover",
    selected && "bg-surface shadow-[0_0_0_1px_var(--line)] hover:bg-surface",
  );

const rowAvatarClass = "h-9 w-9";

function UnreadBadge({ count }: { count: number }) {
  return (
    <span className="inline-flex h-4.5 min-w-4.5 shrink-0 items-center justify-center rounded-full bg-accent px-1.5 font-mono text-2xs font-bold tabular-nums text-accent-ink">
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
        <span className={cn("min-w-0 flex-1 truncate text-[0.8125rem] leading-[1.125rem]", hasUnread ? "text-ink" : "text-muted")}>{preview}</span>
        {hasUnread ? <UnreadBadge count={unread} /> : null}
      </span>
    </span>
  );
}

/**
 * A project's chat: the project's photo, or a square tile tinted with its color
 * and its letter (#403). Its visible text is its accessible name.
 */
function ProjectChatRow({ chat, selected }: { chat: ChatSummary; selected: boolean }) {
  return (
    <Link href={`/chats?project=${chat.projectId}`} scroll={false} aria-current={selected ? "true" : undefined} className={rowClass(selected)}>
      <ProjectAvatar
        project={{ id: chat.projectId, name: chat.name, color: chat.color, photoUpdatedAt: chat.photoUpdatedAt }}
        className={cn(rowAvatarClass, "rounded-[0.625rem] text-[0.9375rem]")}
      />
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
      <PersonAvatar id={personId} name={name} className={cn(rowAvatarClass, "text-[0.8125rem]")} />
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
    <h2 id={id} className="px-2.5 pb-1 pt-3 text-2xs font-bold uppercase tracking-wider text-muted">
      {children}
    </h2>
  );
}

/**
 * A chat in the column of photos (#416, design 3A): its photo, tile or initials, the unread count on
 * it, and its name in a tooltip. Screen readers get the name and the count from hidden words.
 */
function ChatPhotoLink({ href, name, unread, selected, children }: { href: string; name: string; unread: number; selected: boolean; children: ReactNode }) {
  return (
    <Tooltip
      content={
        unread ? (
          <>
            {name} <TooltipDetail>{unread} new</TooltipDetail>
          </>
        ) : (
          name
        )
      }
    >
      <Link
        href={href}
        scroll={false}
        aria-current={selected ? "true" : undefined}
        className={cn(
          "relative grid h-13 w-13 place-items-center rounded-[0.875rem] transition-colors hover:bg-surface-hover",
          selected && "bg-surface shadow-[0_0_0_1px_var(--line)] hover:bg-surface",
        )}
      >
        {children}
        <span className="sr-only">{unread ? `${name}, ${unread} unread message${unread === 1 ? "" : "s"}` : name}</span>
        {unread ? (
          <span
            aria-hidden="true"
            className={cn(
              "absolute right-px top-0.5 inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-accent px-1.5 font-mono text-2xs font-bold tabular-nums text-accent-ink ring-2",
              selected ? "ring-surface" : "ring-canvas",
            )}
          >
            {formatUnreadCount(unread)}
          </span>
        ) : null}
      </Link>
    </Tooltip>
  );
}

export function ChatsHub({
  chats,
  directs,
  teammates,
  selected,
  currentUser,
  initialList,
}: {
  chats: ChatSummary[];
  directs: DirectChatSummary[];
  /** Everyone you share a project with, for the people search. */
  teammates: Teammate[];
  selected: SelectedChat | null;
  currentUser: { name: string | null; email: string };
  /** The desktop list's width and whether it's shrunk to photos, from its cookies (#416). */
  initialList: PanelSize;
}) {
  const router = useRouter();
  const [listSize, setListSize] = useState(initialList);
  const searchInput = useRef<HTMLInputElement>(null);
  const filterRow = useRef<HTMLDivElement>(null);
  const [filtersCut, setFiltersCut] = useState(false);
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

  // Below about 284 px the filters no longer fit, so they scroll sideways under a fade (#416).
  useEffect(() => {
    const row = filterRow.current;
    if (!row) return;
    const update = () => setFiltersCut(row.scrollWidth - row.scrollLeft - row.clientWidth > 1);
    const observer = new ResizeObserver(update);
    observer.observe(row);
    row.addEventListener("scroll", update, { passive: true });
    return () => {
      observer.disconnect();
      row.removeEventListener("scroll", update);
    };
  }, []);

  // Dragging the edge updates the width as it goes and saves it when let go, so the server renders it next time.
  function resizeList(next: PanelSize, done: boolean) {
    setListSize(next);
    if (done) savePanelCookies(CHATS_LIST_WIDTH_COOKIE, CHATS_LIST_COMPACT_COOKIE, next);
  }

  // The column's magnifier opens the whole list again, with the cursor in its search.
  function openFullList() {
    resizeList({ ...listSize, collapsed: false }, true);
    window.requestAnimationFrame(() => searchInput.current?.focus());
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

  const compact = listSize.collapsed;

  return (
    <div className="flex h-full min-h-0">
      {/* Phones show the list or the chat. On desktop the list always sits beside the chat, at the width
          its edge was dragged to (#416, design 2B), and never takes the conversation below 360 px. */}
      <section
        id="chat-list"
        aria-labelledby="chats-heading"
        className={cn(
          "relative min-h-0 w-full flex-col bg-canvas transition-[width] duration-200 data-[resizing]:transition-none lg:w-[var(--chat-list-width)] lg:max-w-[calc(100%-22.5rem)] lg:shrink-0 lg:border-r lg:border-line",
          selected ? "hidden lg:flex" : "flex",
        )}
        style={{ "--chat-list-width": `${shownWidth(listSize, CHAT_LIST_LIMITS)}rem` } as CSSProperties}
      >
        {/* The whole list; phones keep it even while the desktop list is shrunk to photos. */}
        <div className={cn("flex min-h-0 flex-1 flex-col overflow-hidden", compact && "lg:hidden")}>
          <div className="grid gap-2.5 px-4 pb-2 pt-4">
            <div className="flex items-center gap-2">
              {/* 16 px, a step above the sidebar's "AI Multi" (#416). */}
              <h1 id="chats-heading" className="min-w-0 flex-1 truncate text-base font-bold">Chats</h1>
              <button
                type="button"
                onClick={() => void markAllRead()}
                disabled={!unreadChats || markingAll}
                className={cn(uiButtonClass, "shrink-0 gap-1.5 px-2 py-1 text-xs disabled:opacity-60")}
              >
                <CheckCheck aria-hidden="true" className="h-3.5 w-3.5" />
                Mark all read
              </button>
            </div>
            <label className="relative block">
              <span className="sr-only">{searchLabel}</span>
              <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
              <input
                ref={searchInput}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={searchLabel}
                className="w-full rounded-lg border border-line bg-surface py-1.5 pl-8 pr-3 text-[0.8125rem] leading-5 text-ink outline-none transition-colors placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/25"
              />
            </label>
            <div
              ref={filterRow}
              role="group"
              aria-label="Show"
              className={cn(
                "flex gap-1.5 overflow-x-auto [scrollbar-width:none]",
                filtersCut && "[mask-image:linear-gradient(to_right,#000_calc(100%-1.75rem),transparent)]",
              )}
            >
              {FILTERS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  aria-pressed={filter === item.value}
                  onClick={() => setFilter(item.value)}
                  className={cn(
                    "shrink-0 rounded-full border px-2.5 py-1 text-[0.75rem] font-semibold leading-4 transition-colors",
                    filter === item.value ? "border-accent bg-accent-soft text-accent" : "border-line bg-surface text-muted hover:text-ink",
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-4">{list}</div>
        </div>

        {/* Dragged past 240 px on desktop: a column of photos with their unread counts, like Telegram Desktop (#416, design 3A). */}
        {compact ? (
          <div className="hidden min-h-0 flex-1 flex-col items-center overflow-y-auto py-4 [scrollbar-width:none] lg:flex">
            <h1 className="sr-only">Chats</h1>
            <Tooltip content="Search chats">
              <button
                type="button"
                onClick={openFullList}
                aria-label="Search chats"
                className="grid h-9 w-10 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-hover hover:text-ink"
              >
                <Search aria-hidden="true" className="h-4 w-4" />
              </button>
            </Tooltip>
            {orderedChats.length ? (
              <>
                <div aria-hidden="true" className="my-2.5 h-px w-6 shrink-0 bg-line" />
                <ul aria-label="Project chats" className="flex flex-col items-center gap-0.5">
                  {orderedChats.map((chat) => (
                    <li key={chat.projectId}>
                      <ChatPhotoLink href={`/chats?project=${chat.projectId}`} name={chat.name} unread={chat.unread} selected={isSelected(projectChatKey(chat.projectId))}>
                        <ProjectAvatar project={{ id: chat.projectId, name: chat.name, color: chat.color, photoUpdatedAt: chat.photoUpdatedAt }} />
                      </ChatPhotoLink>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            {orderedDirects.length ? (
              <>
                <div aria-hidden="true" className="my-2.5 h-px w-6 shrink-0 bg-line" />
                <ul aria-label="Direct messages" className="flex flex-col items-center gap-0.5">
                  {orderedDirects.map((chat) => (
                    <li key={chat.personId}>
                      <ChatPhotoLink href={`/chats?person=${chat.personId}`} name={chat.name} unread={chat.unread} selected={isSelected(directChatKey(chat.personId))}>
                        <PersonAvatar id={chat.personId} name={chat.name} />
                      </ChatPhotoLink>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
        ) : null}

        <ResizeHandle
          label="Resize chat list"
          controls="chat-list"
          size={listSize}
          limits={CHAT_LIST_LIMITS}
          collapsedText="Photos only"
          onResize={resizeList}
          className="hidden lg:block"
        />
      </section>

      <section aria-label="Conversation" className={cn("min-w-0 flex-1 flex-col bg-surface lg:flex", selected ? "flex" : "hidden")}>
        {selected ? (
          // Search (#409) belongs to the open chat: another chat starts with it closed.
          <ChatSearchProvider key={selectedKey}>
            {/* The page's heading lives in the list, which phones hide while a chat is open; screen readers still get it here. */}
            <h1 className="sr-only lg:hidden">Chats</h1>
            {/* One row on phones too: back, the name, then the header's buttons. Board and the project page are in ⋯ (#408). */}
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
              {selected.kind === "project" ? (
                <>
                  {/* The project's photo, not its color (#403); the owner clicks it to change it. */}
                  <ProjectPhotoButton
                    key={selected.chat.id}
                    project={{ id: selected.chat.id, name: selected.chat.name, color: selected.chat.color, photoUpdatedAt: selected.chat.photoUpdatedAt }}
                    canChange={selected.chat.canChangePhoto}
                    className="h-9 w-9 text-sm"
                  />
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-base font-bold">{selected.chat.name}</h2>
                    <p className="truncate text-xs text-muted">{plural(selected.chat.memberCount, "member")}</p>
                  </div>
                  <div className="flex shrink-0 gap-1.5 sm:gap-2">
                    <ChatSearchButton />
                    <ProjectChatMenu projectId={selected.chat.id} projectName={selected.chat.name} />
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
                  <ChatSearchButton />
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
          </ChatSearchProvider>
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
