"use client";

import { ChevronDown, ChevronLeft, Ellipsis, History, Pencil, SquareArrowOutUpRight, SquarePen, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { AiChatList, KEPT_CHATS_TEXT } from "@/components/ai/ai-chat-list";
import { useAiChat } from "@/components/ai/ai-chat-provider";
import { AI_PLACEHOLDER, AiComposer, AiFooter } from "@/components/ai/ai-composer";
import { AiNotice } from "@/components/ai/ai-notice";
import { AiSpark } from "@/components/ai/ai-spark";
import { AI_SUGGESTIONS } from "@/components/ai/ai-suggestions";
import { AiThread, AiThreadLoading } from "@/components/ai/ai-thread";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { allowanceLine } from "@/lib/ai/chat-client";
import { cn } from "@/lib/cn";

function IconButton({ label, onClick, children, className }: { label: string; onClick?: () => void; children: ReactNode; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-hover hover:text-ink max-lg:h-11 max-lg:w-11", className)}
    >
      {children}
    </button>
  );
}

/**
 * The inside of the AI bar's open chat (#308, round 3): a header with the person's chats (#452),
 * New chat, a ⋯ menu (which also renames and deletes a stored chat) and Collapse; the
 * conversation, or a new chat's questions to start from; and the message box. The computer's
 * floating chat and the phone's full-screen sheet both use it.
 */
export function AiChatPanel({
  onCollapse,
  onNavigate,
  composerRef,
  menuItems,
  announce = true,
}: {
  onCollapse: () => void;
  /** Following a link out of the chat: an answer's source, or the AI page. */
  onNavigate?: () => void;
  composerRef?: Ref<HTMLTextAreaElement>;
  /** More items for the ⋯ menu, after "Open on the AI page". */
  menuItems?: ReactNode;
  /** Whether the panel holds the screen-reader status for answers (a modal sheet must). */
  announce?: boolean;
}) {
  const chat = useAiChat();
  const { chats, current, busy, opening, notice, status, announcement, loadChats } = chat;
  const [view, setView] = useState<"chat" | "history">("chat");
  const body = useRef<HTMLDivElement>(null);
  // Whether the reader is at the end of the conversation, so new words keep it in view.
  const atEnd = useRef(true);
  const allowance = allowanceLine(status);

  // The stored chats are read when the chat first opens, so its history is there at once.
  useEffect(() => {
    loadChats();
  }, [loadChats]);

  const turns = current?.turns;
  useEffect(() => {
    const element = body.current;
    if (element && atEnd.current) element.scrollTop = element.scrollHeight;
  }, [turns, notice.open, view]);

  function startNewChat() {
    chat.newChat();
    setView("chat");
    atEnd.current = true;
  }

  return (
    <>
      <div className="flex min-h-10 shrink-0 items-center gap-0.5 px-2 pb-1">
        {view === "chat" ? (
          <>
            <IconButton label="Chat history" onClick={() => setView("history")}>
              <History aria-hidden="true" className="h-4.5 w-4.5" />
            </IconButton>
            <p className="min-w-0 flex-1 truncate pl-1 text-sm font-semibold">{current?.title ?? "New chat"}</p>
            <IconButton label="New chat" onClick={startNewChat}>
              <SquarePen aria-hidden="true" className="h-4.5 w-4.5" />
            </IconButton>
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label="More"
                title="More"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted outline-none transition-colors hover:bg-surface-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-accent data-[state=open]:bg-surface-hover max-lg:h-11 max-lg:w-11"
              >
                <Ellipsis aria-hidden="true" className="h-4.5 w-4.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuItem asChild>
                  <Link href="/ai" onClick={onNavigate}>
                    <SquareArrowOutUpRight />
                    Open on the AI page
                  </Link>
                </DropdownMenuItem>
                {menuItems}
                {/* A stored chat's own actions (#452), not while an answer is arriving. */}
                {current?.serverId && !busy ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => chat.renameChat(current.id)}>
                      <Pencil />
                      Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => chat.deleteChat(current.id)} className="text-danger [&_svg]:text-danger">
                      <Trash2 />
                      Delete chat
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
            <IconButton label="Collapse" onClick={onCollapse}>
              <ChevronDown aria-hidden="true" className="h-4.5 w-4.5" />
            </IconButton>
          </>
        ) : (
          <>
            <IconButton label="Back to the chat" onClick={() => setView("chat")}>
              <ChevronLeft aria-hidden="true" className="h-4.5 w-4.5" />
            </IconButton>
            <p className="min-w-0 flex-1 truncate pl-1 text-sm font-semibold">Chats</p>
            <IconButton label="New chat" onClick={startNewChat}>
              <SquarePen aria-hidden="true" className="h-4.5 w-4.5" />
            </IconButton>
          </>
        )}
      </div>

      {view === "history" ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          <AiChatList
            chats={chats}
            onOpen={(id) => {
              chat.openChat(id);
              setView("chat");
              atEnd.current = true;
            }}
          />
          <p className="px-2 pb-1 pt-3 text-xs text-muted">{KEPT_CHATS_TEXT} Delete any from its ⋯ menu.</p>
        </div>
      ) : (
        <>
          <div
            ref={body}
            onScroll={(event) => {
              const element = event.currentTarget;
              atEnd.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
            }}
            className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-4 pt-2 max-sm:px-4"
          >
            {opening ? (
              <AiThreadLoading />
            ) : current?.turns?.length ? (
              <AiThread turns={current.turns} busy={busy} onRetry={chat.retry} onNavigate={onNavigate} />
            ) : notice.open ? null : (
              <div className="m-auto flex w-full flex-col items-center gap-3 py-4 text-center">
                <AiSpark className="h-10 w-10" />
                <p className="text-[1.0625rem] font-semibold tracking-[-0.01em]">{AI_PLACEHOLDER}</p>
                <ul className="grid w-full max-w-[26.25rem] gap-1.5">
                  {AI_SUGGESTIONS.map(({ text, icon: Icon }) => (
                    <li key={text}>
                      <button
                        type="button"
                        onClick={() => {
                          atEnd.current = true;
                          chat.ask(text);
                        }}
                        disabled={busy}
                        className="flex w-full items-center gap-2.5 rounded-xl border border-line bg-surface px-3 py-2.5 text-left text-[0.84375rem] text-ink transition-colors hover:bg-surface-hover disabled:opacity-60 max-lg:min-h-11"
                      >
                        <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-muted" />
                        {text}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {notice.open ? <AiNotice className={cn(current?.turns?.length ? "mt-4" : "my-auto")} /> : null}
          </div>
          <div className="shrink-0 px-3">
            <AiComposer ref={composerRef} />
            <AiFooter allowance={allowance} />
          </div>
        </>
      )}

      {/* "AI Multi is answering…", then the whole answer once it's in, rather than every streamed piece.
          The floating chat keeps it outside, so it's read even while the chat is collapsed. */}
      {announce ? (
        <p role="status" className="sr-only">
          {announcement}
        </p>
      ) : null}
    </>
  );
}
