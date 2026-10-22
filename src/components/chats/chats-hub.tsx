"use client";

/**
 * The Chats hub (SIDE-02): the list of project chats on the left, the open
 * chat on the right. On phones the list and the chat are separate screens.
 */

import { ArrowLeft, CheckCheck, LayoutDashboard, MessagesSquare, Paperclip, Search, SquareKanban } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ProjectChatWorkspace } from "@/components/project-chat-workspace";
import { uiButtonClass } from "@/components/ui";
import { toast } from "@/components/ui/toaster";
import {
  chatPreview,
  filterChatSummaries,
  formatUnreadCount,
  type ChatAccessLevel,
  type ChatFilter,
  type ChatSummary,
} from "@/lib/chats";
import type { OpenedProjectChat } from "@/lib/chats-data";
import { cn } from "@/lib/cn";
import { projectColor } from "@/lib/project-color";
import { notifyWorkspaceChanged } from "@/lib/workspace-events";

const roleText: Record<ChatAccessLevel, string> = {
  OWNER: "You own this project",
  EDITOR: "You can post",
  VIEWER: "Read only",
};

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** One chat in the list. Its visible text is its accessible name, plus "unread messages" after the count. */
function ChatRow({ chat, selected }: { chat: ChatSummary; selected: boolean }) {
  const unread = chat.unread > 0;

  return (
    <Link
      href={`/chats?project=${chat.projectId}`}
      scroll={false}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "flex gap-3 rounded-xl px-3 py-3 transition-colors hover:bg-surface-hover",
        selected && "bg-surface shadow-[0_0_0_1px_var(--line)] hover:bg-surface",
      )}
    >
      <span aria-hidden="true" className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: projectColor({ id: chat.projectId, color: chat.color }) }} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-baseline gap-2">
          <span className={cn("min-w-0 flex-1 truncate text-sm", unread ? "font-bold" : "font-semibold")}>{chat.name}</span>
          {chat.accessLevel === "VIEWER" ? (
            <span className="shrink-0 rounded-full bg-sunken px-1.5 text-[11px] font-semibold text-muted">Viewer</span>
          ) : null}
          {chat.lastMessage ? (
            <span className={cn("shrink-0 text-xs", unread ? "font-bold text-accent" : "text-muted")}>{chat.lastMessage.timeLabel}</span>
          ) : null}
        </span>
        <span className="flex items-center gap-1.5">
          {chat.lastMessage?.attachmentCount ? <Paperclip aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-muted" /> : null}
          <span className={cn("min-w-0 flex-1 truncate text-[13px]", unread ? "text-ink" : "text-muted")}>{chatPreview(chat)}</span>
          {unread ? (
            <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-bold tabular-nums text-accent-ink">
              {formatUnreadCount(chat.unread)}
              <span className="sr-only"> unread message{chat.unread === 1 ? "" : "s"}</span>
            </span>
          ) : null}
        </span>
      </span>
    </Link>
  );
}

export function ChatsHub({
  chats,
  selected,
  currentUser,
}: {
  chats: ChatSummary[];
  selected: OpenedProjectChat | null;
  currentUser: { name: string | null; email: string };
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<ChatFilter>("all");
  const [query, setQuery] = useState("");
  const [markingAll, setMarkingAll] = useState(false);
  // The order from when the page loaded, so a chat doesn't jump away once it's read; a reload re-sorts.
  const [loadOrder] = useState(() => new Map(chats.map((chat, index) => [chat.projectId, index])));
  // Likewise, a chat that was unread stays under "Unread" after it's opened.
  const [unreadAtLoad] = useState(() => new Set(chats.filter((chat) => chat.unread > 0).map((chat) => chat.projectId)));

  const ordered = [...chats].sort(
    (a, b) => (loadOrder.get(a.projectId) ?? Number.MAX_SAFE_INTEGER) - (loadOrder.get(b.projectId) ?? Number.MAX_SAFE_INTEGER),
  );
  const visible = filterChatSummaries(ordered, filter, query, unreadAtLoad);
  const unreadChats = chats.filter((chat) => chat.unread > 0).length;
  const selectedId = selected?.id ?? null;
  const summary = chats.length
    ? `${unreadChats ? `${unreadChats} with new messages` : "All caught up"} · ${plural(chats.length, "project")}`
    : "No project chats yet";

  // Opening a chat marked it read on the server; the sidebar fetches its counts again.
  useEffect(() => {
    if (selectedId) notifyWorkspaceChanged();
  }, [selectedId]);

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

  const emptyText = !chats.length
    ? null
    : filter === "unread" && !query.trim()
      ? "You're all caught up."
      : `No chats match “${query.trim()}”.`;

  return (
    <div className="flex h-full min-h-0">
      <section
        aria-labelledby="chats-heading"
        className={cn("min-h-0 w-full flex-col bg-canvas lg:flex lg:w-[22.5rem] lg:shrink-0 lg:border-r lg:border-line", selected ? "hidden" : "flex")}
      >
        <div className="grid gap-3 px-4 pb-3 pt-5">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h1 id="chats-heading" className="text-2xl font-extrabold tracking-tight">Chats</h1>
              <p className="mt-0.5 text-sm text-muted">{summary}</p>
            </div>
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
            <span className="sr-only">Search chats</span>
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search chats"
              className="w-full rounded-lg border border-line bg-surface py-2 pl-9 pr-3 text-sm text-ink outline-none transition-colors placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/25"
            />
          </label>
          <div role="group" aria-label="Show" className="inline-flex w-fit gap-0.5 rounded-[10px] bg-sunken p-[3px]">
            {(["all", "unread"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
                className={cn(
                  "rounded-lg px-3 py-1 text-[13px] font-semibold transition-colors",
                  filter === value ? "bg-surface text-ink shadow-[0_0_0_1px_var(--line)]" : "text-muted hover:text-ink",
                )}
              >
                {value === "all" ? "All" : `Unread ${unreadChats}`}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-4">
          {visible.length ? (
            <ul aria-label="Project chats" className="flex flex-col gap-1">
              {visible.map((chat) => (
                <li key={chat.projectId} className="min-w-0">
                  <ChatRow chat={chat} selected={chat.projectId === selectedId} />
                </li>
              ))}
            </ul>
          ) : emptyText ? (
            <p className="px-3 py-8 text-center text-sm text-muted">{emptyText}</p>
          ) : (
            <div className="px-3 py-8 text-center text-sm text-muted">
              <p>Each project has a team chat. Create a project to start one.</p>
              <Link href="/projects" className="mt-2 inline-block font-semibold text-accent hover:underline">
                Go to Projects
              </Link>
            </div>
          )}
        </div>
      </section>

      <section aria-label="Conversation" className={cn("min-w-0 flex-1 flex-col bg-surface lg:flex", selected ? "flex" : "hidden")}>
        {selected ? (
          <>
            <div className="border-b border-line px-4 py-3 sm:px-5">
              <Link
                href="/chats"
                scroll={false}
                className="-ml-1.5 mb-2 inline-flex items-center gap-1 rounded-lg px-1.5 py-1 text-sm font-medium text-muted hover:bg-surface-hover hover:text-ink lg:hidden"
              >
                <ArrowLeft aria-hidden="true" className="h-4 w-4" />
                All chats
              </Link>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded" style={{ backgroundColor: projectColor({ id: selected.id, color: selected.color }) }} />
                <div className="min-w-48 flex-1">
                  <h2 className="truncate text-base font-bold">{selected.name}</h2>
                  <p className="text-xs text-muted">
                    {plural(selected.memberCount, "member")} · {roleText[selected.accessLevel]}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Link href={`/projects/${selected.id}/board`} className={cn(uiButtonClass, "gap-1.5 px-2.5 py-1.5 text-xs")}>
                    <SquareKanban aria-hidden="true" className="h-3.5 w-3.5 text-muted" />
                    Board
                  </Link>
                  <Link href={`/projects/${selected.id}`} className={cn(uiButtonClass, "gap-1.5 px-2.5 py-1.5 text-xs")}>
                    <LayoutDashboard aria-hidden="true" className="h-3.5 w-3.5 text-muted" />
                    Open project
                  </Link>
                </div>
              </div>
            </div>
            <div className="flex min-h-0 flex-1 flex-col p-3 sm:p-4">
              <ProjectChatWorkspace
                key={selected.id}
                projectId={selected.id}
                currentUser={currentUser}
                readOnly={selected.readOnly}
                attachmentsDisabledMessage={selected.attachmentsDisabledMessage}
                newSince={selected.newSince}
                initialComments={selected.initialComments}
              />
            </div>
          </>
        ) : (
          <div className="m-auto grid max-w-xs justify-items-center gap-2 p-6 text-center">
            <span aria-hidden="true" className="grid h-11 w-11 place-items-center rounded-xl bg-accent-soft text-accent">
              <MessagesSquare className="h-5 w-5" />
            </span>
            <p className="font-bold">Pick a chat</p>
            <p className="text-sm text-muted">
              {unreadChats
                ? `${plural(unreadChats, "chat")} ${unreadChats === 1 ? "has" : "have"} new messages.`
                : "You're all caught up. Pick a chat to read or reply."}
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
