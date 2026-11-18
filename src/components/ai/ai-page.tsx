"use client";

import { ChevronLeft, History, Search, SquarePen } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useAiChat } from "@/components/ai/ai-chat-provider";
import { AiComposer } from "@/components/ai/ai-composer";
import { AiNotice } from "@/components/ai/ai-notice";
import { AiSpark } from "@/components/ai/ai-spark";
import { AI_SUGGESTIONS } from "@/components/ai/ai-suggestions";
import { AiThread } from "@/components/ai/ai-thread";
import { MobileMenuButton } from "@/components/mobile-menu";
import { uiPrimaryButtonClass } from "@/components/ui";
import { ResizeHandle } from "@/components/ui/resize-handle";
import { allowanceLine } from "@/lib/ai/chat-client";
import { cn } from "@/lib/cn";
import { AI_CHAT_LIST_LIMITS, AI_CHAT_LIST_WIDTH_COOKIE, savePanelWidthCookie, type PanelSize } from "@/lib/panel-resize";
import { isAskAiShortcut } from "@/lib/shortcuts";
import { openGuestSignup } from "@/lib/workspace-events";

/**
 * The AI page for a guest (#458): what the assistant answers, and the sign-up pop-up, which opens on
 * arrival as if the AI had been clicked. Any question opens it again.
 */
function GuestAiPage() {
  useEffect(() => {
    // After this commit: the page's effects run before the app shell's, which listens for the event.
    const timer = window.setTimeout(() => openGuestSignup("ai"), 0);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <h1 className="sr-only">AI</h1>
      {/* Phones and tablets have no bar above this page; its menu button sits here (#420). */}
      <div className="flex h-14 shrink-0 items-center border-b border-line pl-1.5 pr-1 lg:hidden">
        <MobileMenuButton className="mr-1 max-lg:h-11 max-lg:w-11" />
        <p className="text-[0.9375rem] font-semibold">AI</p>
      </div>
      <div className="m-auto flex w-full flex-col items-center gap-4 px-4 py-6 text-center sm:px-6">
        <AiSpark className="h-10 w-10" />
        <p className="text-[1.625rem] font-semibold leading-tight tracking-[-0.02em]">Ask AI Multi about your work</p>
        <p className="max-w-[28rem] text-sm text-muted">It answers from your tasks, calendar and projects. It needs a free account.</p>
        <ul className="grid w-full max-w-[32.5rem] gap-1.5">
          {AI_SUGGESTIONS.map(({ text, icon: Icon }) => (
            <li key={text}>
              <button
                type="button"
                onClick={() => openGuestSignup("ai")}
                className="flex w-full items-center gap-2.5 rounded-xl border border-line bg-surface px-3 py-2.5 text-left text-[0.84375rem] text-ink transition-colors hover:bg-surface-hover max-lg:min-h-11"
              >
                <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-muted" />
                {text}
              </button>
            </li>
          ))}
        </ul>
        <button type="button" onClick={() => openGuestSignup("ai")} className={cn(uiPrimaryButtonClass, "shine mt-1 font-semibold max-lg:min-h-11")}>
          Sign up free to use the AI
        </button>
      </div>
    </div>
  );
}

const iconButtonClass =
  "grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-hover hover:text-ink max-lg:h-11 max-lg:w-11";

/**
 * The AI page (#308, the classic layout picked on the round-3 canvas): this tab's chats on the
 * left, in a list whose edge resizes from 220 to 360 px like the sidebar's, and the conversation
 * in a 760 px column with one message box. Phones show the conversation, and the list full screen
 * from the clock button. The chat itself lives above the page (AiChatProvider in the root layout),
 * so a conversation stays while people look at the items it links to.
 */
export function AiPage({ firstName, initialListWidth }: { firstName: string; initialListWidth: number }) {
  const chat = useAiChat();
  const { enabled, chats, current, status, busy, notice, announcement, loadStatus } = chat;
  const [list, setList] = useState<PanelSize>({ width: initialListWidth, collapsed: false });
  const [showList, setShowList] = useState(false);
  const [query, setQuery] = useState("");
  const composer = useRef<HTMLTextAreaElement>(null);
  const thread = useRef<HTMLDivElement>(null);
  // Whether the reader is at the end of the conversation, so new words keep it in view.
  const atEnd = useRef(true);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  // Ctrl J (Cmd J), which opens the AI bar's chat on other pages, puts the cursor in this page's box.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isAskAiShortcut(event) || document.querySelector('[role="dialog"][aria-modal="true"], [role="alertdialog"]')) return;
      event.preventDefault();
      composer.current?.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // New words keep the conversation scrolled to its end, unless the reader has scrolled up.
  const turns = current?.turns;
  useEffect(() => {
    const element = thread.current;
    if (element && atEnd.current) element.scrollTop = element.scrollHeight;
  }, [turns, notice.open]);

  const matches = query.trim() ? chats.filter((item) => item.title.toLowerCase().includes(query.trim().toLowerCase())) : chats;
  const allowance = allowanceLine(status);
  const title = current?.title ?? "New chat";

  function startNewChat() {
    chat.newChat();
    setShowList(false);
    atEnd.current = true;
    composer.current?.focus();
  }

  function resizeList(next: PanelSize, done: boolean) {
    setList({ width: next.width, collapsed: false });
    if (done) savePanelWidthCookie(AI_CHAT_LIST_WIDTH_COOKIE, next.width);
  }

  if (!enabled) return <GuestAiPage />;

  return (
    <div className="flex h-full min-h-0">
      <h1 className="sr-only">AI</h1>

      <section
        id="ai-chats"
        aria-labelledby="ai-chats-heading"
        className={cn(
          "relative min-h-0 w-full flex-col bg-canvas transition-[width] duration-200 data-[resizing]:transition-none lg:w-[var(--ai-chats-width)] lg:shrink-0 lg:border-r lg:border-line",
          showList ? "flex" : "hidden lg:flex",
        )}
        style={{ "--ai-chats-width": `${list.width}rem` } as CSSProperties}
      >
        <div className="flex min-h-14 items-center gap-1.5 pb-2 pl-4 pr-2.5 pt-3 max-lg:pl-2">
          <button type="button" onClick={() => setShowList(false)} aria-label="Back to the chat" className={cn(iconButtonClass, "lg:hidden")}>
            <ChevronLeft aria-hidden="true" className="h-5 w-5" />
          </button>
          <h2 id="ai-chats-heading" className="min-w-0 flex-1 truncate text-[0.9375rem] font-semibold">
            Chats
          </h2>
          <button type="button" onClick={startNewChat} aria-label="New chat" title="New chat" className={iconButtonClass}>
            <SquarePen aria-hidden="true" className="h-4.5 w-4.5" />
          </button>
        </div>
        <label className="relative mx-2.5 mb-1 block">
          <span className="sr-only">Search chats</span>
          <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search chats"
            className="w-full rounded-lg border border-line bg-surface py-1.5 pl-8 pr-3 text-[0.8125rem] leading-5 text-ink outline-none transition-colors placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/25"
          />
        </label>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 pt-1">
          {/* grid-cols-1: an auto column would grow to the longest title and push it past the list. */}
          {matches.length ? (
            <ul className="grid grid-cols-1 gap-px">
              {matches.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => {
                      chat.openChat(item.id);
                      setShowList(false);
                      atEnd.current = true;
                    }}
                    aria-current={item.id === current?.id ? "true" : undefined}
                    className={cn(
                      "flex h-[2.125rem] w-full items-center rounded-lg px-2 text-left text-[0.84375rem] text-ink transition-colors hover:bg-surface-hover max-lg:h-11 max-lg:text-[0.9375rem]",
                      item.id === current?.id && "bg-surface font-semibold shadow-[0_0_0_1px_var(--line)] hover:bg-surface",
                    )}
                  >
                    <span className="truncate">{item.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-2 py-3 text-xs text-muted">{chats.length ? "No chats match." : "Your chats will show here."}</p>
          )}
          {/* Until chat history is stored (#452), a chat lasts as long as the tab. */}
          <p className="px-2 pb-1 pt-3 text-xs text-muted">Chats stay here until you reload or close this tab.</p>
        </div>
        <ResizeHandle label="Resize your chats" controls="ai-chats" size={list} limits={AI_CHAT_LIST_LIMITS} onResize={resizeList} className="hidden lg:block" />
      </section>

      <section aria-label="Conversation" className={cn("min-w-0 flex-1 flex-col bg-surface", showList ? "hidden lg:flex" : "flex")}>
        <div className="flex h-14 shrink-0 items-center gap-0.5 border-b border-line pl-1.5 pr-1 sm:gap-2 lg:pl-5 lg:pr-3">
          {/* Phones and tablets have no bar above this page; its menu button sits here (#420). */}
          <MobileMenuButton className="mr-1 max-lg:h-11 max-lg:w-11 lg:hidden" />
          <p className="min-w-0 flex-1 truncate text-[0.9375rem] font-semibold">
            <span className="lg:hidden">{current ? title : "AI"}</span>
            <span className="max-lg:hidden">{title}</span>
          </p>
          {allowance ? <span className="whitespace-nowrap text-xs text-muted max-lg:hidden">{allowance}</span> : null}
          <button type="button" onClick={() => setShowList(true)} aria-label="Your chats" title="Your chats" className={cn(iconButtonClass, "lg:hidden")}>
            <History aria-hidden="true" className="h-4.5 w-4.5" />
          </button>
          <button type="button" onClick={startNewChat} aria-label="New chat" title="New chat" className={cn(iconButtonClass, "lg:hidden")}>
            <SquarePen aria-hidden="true" className="h-4.5 w-4.5" />
          </button>
        </div>

        <div
          ref={thread}
          onScroll={(event) => {
            const element = event.currentTarget;
            atEnd.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
          }}
          className="flex min-h-0 flex-1 flex-col overflow-y-auto"
        >
          {current?.turns.length ? (
            <AiThread chat={current} busy={busy} onRetry={chat.retry} className="mx-auto w-full max-w-[47.5rem] px-4 pb-2 pt-6 sm:px-6" />
          ) : notice.open ? null : (
            <div className="m-auto flex w-full flex-col items-center gap-4 px-4 py-6 text-center sm:px-6">
              <AiSpark className="h-10 w-10" />
              <p className="text-[1.625rem] font-semibold leading-tight tracking-[-0.02em]">
                What do you want to get done<span className="max-lg:hidden">, {firstName}</span>?
              </p>
              <ul className="grid w-full max-w-[32.5rem] gap-1.5">
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
          {notice.open ? <AiNotice className={cn("mx-auto w-[calc(100%-2rem)] max-w-[44.5rem] sm:w-[calc(100%-3rem)]", current?.turns.length ? "mb-3" : "my-auto")} /> : null}
        </div>

        <div className="mx-auto w-full max-w-[49rem] shrink-0 px-3 pt-1">
          <AiComposer ref={composer} />
          <p className="px-3 pb-2.5 pt-1.5 text-center text-[0.71875rem] text-muted">
            <span className="lg:hidden">{allowance ? `${allowance} · ` : ""}Nothing changes until you confirm</span>
            <span className="max-lg:hidden">Answers can be wrong. Nothing changes until you confirm it.</span>
          </p>
        </div>
      </section>

      {/* "Answering…", then the whole answer once it's in, rather than every streamed piece. */}
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
