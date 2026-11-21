"use client";

import { ArrowUp, ChevronDown, EyeOff, Minimize2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from "react";
import { AiChatPanel } from "@/components/ai/ai-chat-panel";
import { useAiChat, useAiDock } from "@/components/ai/ai-chat-provider";
import { AI_PLACEHOLDER, AI_PLACEHOLDER_SHORT } from "@/components/ai/ai-composer";
import { AiSpark } from "@/components/ai/ai-spark";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toaster";
import { MAX_MESSAGE_CHARS } from "@/lib/ai/chat-limits";
import { CHAT_SIZE, CHAT_SIZE_KEY, dragChatSize, keyChatSize, parseChatSize, type ChatEdge, type ChatSize } from "@/lib/ai/chat-size";
import { cn } from "@/lib/cn";
import { isAskAiShortcut } from "@/lib/shortcuts";

const WIDE_QUERY = "(min-width: 1024px)";

/** True where the sidebar shows (Tailwind's lg): the chat floats over the page there, and opens full screen below it. */
function useWideScreen() {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(WIDE_QUERY);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => window.matchMedia(WIDE_QUERY).matches,
    () => true,
  );
}

function readSavedSize() {
  try {
    return parseChatSize(window.localStorage.getItem(CHAT_SIZE_KEY));
  } catch {
    return { ...CHAT_SIZE.initial };
  }
}

function saveSize(size: ChatSize) {
  try {
    window.localStorage.setItem(CHAT_SIZE_KEY, JSON.stringify(size));
  } catch {
    // Private mode or storage full: the size lasts until the page reloads.
  }
}

/** The send button's two looks: gray until something is typed, then the accent's gradient (globals.css). */
function sendButtonClass(ready: boolean) {
  return cn(
    "grid h-9 w-9 shrink-0 place-items-center rounded-full transition-[background-color,color,box-shadow] duration-150 motion-reduce:transition-none",
    ready ? "ai-send" : "cursor-default bg-sunken text-muted",
  );
}

/** Where the bar and the chat sit on a computer: centred at the bottom of the page, 24 px up. */
const FLOAT_CLASS = "absolute bottom-6 left-1/2 z-30 -translate-x-1/2";
const BAR_SHADOW = "shadow-[0_1px_2px_rgb(16_26_25/0.06),0_10px_28px_-10px_rgb(16_26_25/0.22)]";

/**
 * After hiding the AI bar: a small note where the ✦ button was, "Moved to AI page | Undo"
 * (round 3). It closes after about 6 seconds, and stays while the pointer is on it (Sonner).
 */
function MovedToast({ id, onUndo }: { id: string | number; onUndo: () => void }) {
  return (
    <div className="ml-auto flex h-9 w-fit items-center gap-1 rounded-[0.625rem] border border-line bg-raised pl-3 pr-1 text-[0.8125rem] text-muted shadow-raised">
      <span>Moved to</span>
      <Link href="/ai" onClick={() => toast.dismiss(id)} className="font-semibold text-accent underline-offset-2 hover:underline">
        AI page
      </Link>
      <span aria-hidden="true" className="ml-1.5 mr-1 h-4 w-px bg-line" />
      <button
        type="button"
        onClick={() => {
          toast.dismiss(id);
          onUndo();
        }}
        className="rounded-md px-2 py-1 font-semibold text-ink transition-colors hover:bg-surface-hover"
      >
        Undo
      </button>
    </div>
  );
}

/**
 * The AI on every page (#308, round 3's quiet bar, no chips): one line at the bottom of the page.
 * Sending a question, the ✦ or Ctrl J (Cmd J on a Mac) opens the chat above it, 760 × 560 px to
 * start, resized from its top edge and top corners and remembered on this device. On phones the
 * bar sits above the tabs and the chat opens full screen.
 *
 * `ownComposer` is for pages with their own message box at the bottom, the chats. On computers
 * they get the same bar as every other page (Samuel, November 21: the chats opened the big chat
 * instead, "I need it to remain simple"), and end above it. On phones their box takes the bottom
 * of the screen, so the AI waits above it as the ✦ button instead of a second box.
 *
 * The person can minimize it to the ✦ button or hide it from pages (it then waits on the AI
 * page); that choice is saved per account (`dock`).
 */
export function AiDock({ ownComposer = false }: { ownComposer?: boolean }) {
  const { draft, setDraft, ask, busy, loadStatus, announcement, current } = useAiChat();
  const { dock, setDock } = useAiDock();
  const router = useRouter();
  const wide = useWideScreen();
  const [expanded, setExpanded] = useState(false);
  const [size, setSize] = useState<ChatSize>(CHAT_SIZE.initial);
  const sizeRead = useRef(false);
  const expandedRef = useRef(false);
  const card = useRef<HTMLElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const barInput = useRef<HTMLInputElement>(null);
  const drag = useRef<{ edge: ChatEdge; x: number; y: number; start: ChatSize; rootPx: number; last: ChatSize } | null>(null);
  const frame = useRef(0);
  const ready = draft.trim().length > 0;

  useEffect(() => {
    expandedRef.current = expanded;
  }, [expanded]);

  const open = useCallback(() => {
    // The size this device chose, read when the chat first opens (the server can't know it).
    if (!sizeRead.current) {
      sizeRead.current = true;
      setSize(readSavedSize());
    }
    setExpanded(true);
  }, []);

  const collapse = useCallback(
    (focusBar = false) => {
      setExpanded(false);
      if (focusBar) window.requestAnimationFrame(() => barInput.current?.focus());
    },
    [],
  );

  // Opening reads the allowance once, and puts the cursor in the chat's message box.
  useEffect(() => {
    if (!expanded) return;
    loadStatus();
    if (wide) composer.current?.focus();
  }, [expanded, wide, loadStatus]);

  // Toasts appear above the bar or the ✦ button while either is there (globals.css), not over them.
  // Once the AI is hidden they come back down, so "Moved to AI page" shows where the button was.
  const shown = dock !== "hidden";
  useEffect(() => {
    if (!shown) return;
    document.documentElement.dataset.aiBar = "";
    return () => {
      delete document.documentElement.dataset.aiBar;
    };
  }, [shown]);

  // Ctrl J or Cmd J, from anywhere but a dialog: opens the chat, or brings the cursor back to it,
  // or, from inside it, closes it again. While the AI is hidden from pages, it goes to the AI page.
  const dockRef = useRef(dock);
  useEffect(() => {
    dockRef.current = dock;
  }, [dock]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isAskAiShortcut(event) || document.querySelector('[role="dialog"][aria-modal="true"], [role="alertdialog"]')) return;
      event.preventDefault();
      if (dockRef.current === "hidden" && !expandedRef.current) router.push("/ai");
      else if (!expandedRef.current) open();
      else if (card.current?.contains(document.activeElement)) collapse(true);
      else composer.current?.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, collapse, router]);

  /** Hides the AI from pages, with Undo in the note that says where it went. */
  function hide() {
    const before = dock;
    collapse();
    setDock("hidden");
    toast.custom((id) => <MovedToast id={id} onUndo={() => setDock(before)} />, { duration: 6000 });
  }

  function minimize() {
    collapse();
    setDock("minimized");
  }

  /** The ✦ button: the bar comes back, and with it the conversation if there is one. Phones open the chat. */
  function reopen() {
    setDock("open");
    if (current?.turns?.length || !wide) open();
    else window.requestAnimationFrame(() => barInput.current?.focus());
  }

  // A drag cut short (the page changes, say) still lets go of the pointer and the cursor.
  useEffect(
    () => () => {
      window.cancelAnimationFrame(frame.current);
      delete document.documentElement.dataset.chatResizing;
    },
    [],
  );

  function sendFromBar() {
    if (!ready) return;
    ask(draft);
    open();
  }

  function startResize(edge: ChatEdge, event: ReactPointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      edge,
      x: event.clientX,
      y: event.clientY,
      start: size,
      rootPx: Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16,
      last: size,
    };
    // The resize pointer everywhere, and no text gets selected along the way (globals.css).
    document.documentElement.dataset.chatResizing = edge;
  }

  function moveResize(event: ReactPointerEvent<HTMLElement>) {
    const current = drag.current;
    if (!current) return;
    const next = dragChatSize(current.edge, current.start, (event.clientX - current.x) / current.rootPx, (event.clientY - current.y) / current.rootPx);
    if (next.width === current.last.width && next.height === current.last.height) return;
    current.last = next;
    // One update per frame, however fast the pointer reports.
    window.cancelAnimationFrame(frame.current);
    frame.current = window.requestAnimationFrame(() => setSize(next));
  }

  function endResize() {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    window.cancelAnimationFrame(frame.current);
    delete document.documentElement.dataset.chatResizing;
    setSize(current.last);
    saveSize(current.last);
  }

  function resizeTo(next: ChatSize) {
    setSize(next);
    saveSize(next);
  }

  const heightPx = Math.round(size.height * 16);

  // In the chat's ⋯ menu, after "Open on the AI page". Minimizing makes sense only while the bar shows.
  const menuItems = (
    <>
      {dock === "open" ? (
        <DropdownMenuItem onSelect={minimize}>
          <Minimize2 />
          Minimize to a button
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuItem onSelect={hide}>
        <EyeOff />
        Hide from pages
      </DropdownMenuItem>
    </>
  );

  return (
    <>
      {expanded && wide ? (
        <section
          ref={card}
          aria-label="AI chat"
          onKeyDown={(event) => {
            // Escape inside the chat closes it; a menu opened from it (rendered elsewhere) closes on its own.
            if (event.key !== "Escape" || !card.current?.contains(event.target as Node)) return;
            event.preventDefault();
            collapse(true);
          }}
          className={cn(FLOAT_CLASS, "flex flex-col overflow-hidden rounded-[1.25rem] border border-line bg-raised shadow-raised")}
          style={{ width: `min(${size.width}rem, calc(100% - 2rem))`, height: `min(${size.height}rem, calc(100% - 3rem))` }}
        >
          {/* The top corners: drag to make it wider or narrower, staying centred, and taller or shorter. */}
          <div
            aria-hidden="true"
            data-chat-corner="left"
            onPointerDown={(event) => startResize("top-left", event)}
            onPointerMove={moveResize}
            onPointerUp={endResize}
            onPointerCancel={endResize}
            onLostPointerCapture={endResize}
            className="absolute left-0 top-0 z-10 h-4.5 w-4.5 cursor-nwse-resize touch-none"
          />
          <div
            aria-hidden="true"
            data-chat-corner="right"
            onPointerDown={(event) => startResize("top-right", event)}
            onPointerMove={moveResize}
            onPointerUp={endResize}
            onPointerCancel={endResize}
            onLostPointerCapture={endResize}
            className="absolute right-0 top-0 z-10 h-4.5 w-4.5 cursor-nesw-resize touch-none"
          />
          {/* The top edge, a separator after the WAI-ARIA window splitter: drag it, ↑ ↓ Home End, or Enter or a double-click for the size it opens at. */}
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize the chat"
            aria-valuemin={CHAT_SIZE.minHeight * 16}
            aria-valuemax={CHAT_SIZE.maxHeight * 16}
            aria-valuenow={heightPx}
            aria-valuetext={`${heightPx} pixels tall`}
            tabIndex={0}
            title="Drag to resize. Double-click for the default size."
            onPointerDown={(event) => startResize("top", event)}
            onPointerMove={moveResize}
            onPointerUp={endResize}
            onPointerCancel={endResize}
            onLostPointerCapture={endResize}
            onDoubleClick={() => resizeTo({ ...CHAT_SIZE.initial })}
            onKeyDown={(event) => {
              const next = keyChatSize(event.key, size);
              if (!next) return;
              event.preventDefault();
              resizeTo(next);
            }}
            className="group flex h-4 w-full shrink-0 cursor-ns-resize touch-none items-center justify-center outline-none"
          >
            <span aria-hidden="true" className="h-1 w-10 rounded-full bg-line transition-colors group-hover:bg-muted/50 group-focus-visible:bg-accent group-active:bg-accent" />
          </div>
          <AiChatPanel onCollapse={() => collapse(true)} composerRef={composer} announce={false} menuItems={menuItems} />
        </section>
      ) : null}

      {/* Answers are announced from here on a computer, so one that arrives after the chat is collapsed is still read. */}
      <p role="status" className="sr-only">
        {announcement}
      </p>

      {/* Phones: the chat opens full screen, as ChatGPT and Gemini do. */}
      <Sheet open={expanded && !wide} onOpenChange={(next) => (next ? open() : collapse())}>
        <SheetContent
          side="bottom"
          hideClose
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            composer.current?.focus();
          }}
          className="h-[calc(100dvh-2.75rem)] max-h-none gap-0 overflow-hidden p-0 pt-2"
        >
          <SheetTitle className="sr-only">AI chat</SheetTitle>
          <SheetDescription className="sr-only">Ask about your tasks, events and projects.</SheetDescription>
          <span aria-hidden="true" className="mx-auto mb-1 h-1 w-10 shrink-0 rounded-full bg-line" />
          <AiChatPanel onCollapse={() => collapse()} onNavigate={() => collapse()} composerRef={composer} menuItems={menuItems} />
        </SheetContent>
      </Sheet>

      {/* The ✦ button: minimized, and on a phone's chats, which have their own message box (above that box there). */}
      {!expanded && (dock === "minimized" || (ownComposer && dock === "open")) ? (
        <div
          className={cn(
            "group/bubble absolute bottom-6 right-6 z-30 h-14 w-14 max-lg:fixed max-lg:right-3",
            ownComposer ? "max-lg:bottom-[calc(8.75rem+max(0.5rem,env(safe-area-inset-bottom)))]" : "max-lg:bottom-[calc(3.9375rem+max(0.5rem,env(safe-area-inset-bottom)))]",
            dock === "open" && "lg:hidden",
          )}
        >
          <button
            type="button"
            onClick={reopen}
            aria-label="Ask AI Multi"
            aria-keyshortcuts="Control+J"
            title="Ask AI Multi (Ctrl J)"
            className="grid h-14 w-14 place-items-center rounded-full border border-line bg-raised shadow-raised transition-colors hover:bg-surface-hover"
          >
            <AiSpark className="h-6 w-6" />
          </button>
          {/* A small × on its right, on hover or focus; phones, without hover, hide it from the chat's ⋯ menu. */}
          <button
            type="button"
            onClick={hide}
            aria-label="Hide from pages"
            title="Hide from pages"
            className="absolute -right-2 -top-2 hidden h-6 w-6 place-items-center opacity-0 transition-opacity focus-visible:opacity-100 group-hover/bubble:opacity-100 group-focus-within/bubble:opacity-100 lg:grid"
          >
            <span className="grid h-4.5 w-4.5 place-items-center rounded-full border border-line bg-raised text-muted shadow-sm transition-colors hover:bg-surface-hover hover:text-ink">
              <X aria-hidden="true" className="h-2.5 w-2.5" strokeWidth={3} />
            </span>
          </button>
        </div>
      ) : null}

      {dock === "open" && !expanded ? (
        <>
          <form
            aria-label="Ask AI Multi"
            onSubmit={(event) => {
              event.preventDefault();
              sendFromBar();
            }}
            className={cn(
              FLOAT_CLASS,
              BAR_SHADOW,
              "hidden h-14 w-[min(45rem,calc(100%-2rem))] items-center gap-2 rounded-full border border-line bg-raised pl-2 pr-2 transition-[border-color,box-shadow] focus-within:border-accent/45 focus-within:ring-[3px] focus-within:ring-accent/15 lg:flex",
            )}
          >
            <button
              type="button"
              onClick={open}
              aria-label="Open the AI chat"
              title="Open the chat (Ctrl J)"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full transition-colors hover:bg-surface-hover"
            >
              <AiSpark />
            </button>
            <input
              ref={barInput}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              maxLength={MAX_MESSAGE_CHARS}
              aria-label="Ask AI Multi"
              aria-keyshortcuts="Control+J"
              placeholder={AI_PLACEHOLDER}
              className="h-10 min-w-0 flex-1 bg-transparent text-[0.9375rem] text-ink outline-none placeholder:text-muted"
            />
            {ready ? null : (
              <kbd aria-hidden="true" className="shrink-0 whitespace-nowrap rounded-md border border-b-2 border-line bg-raised px-1.5 py-0.5 font-mono text-2xs text-muted">
                Ctrl J
              </kbd>
            )}
            <button type="submit" aria-label="Send" title="Send" disabled={busy} className={cn(sendButtonClass(ready), "disabled:opacity-60")}>
              <ArrowUp aria-hidden="true" className="h-4.5 w-4.5" strokeWidth={2.25} />
            </button>
            <button
              type="button"
              onClick={minimize}
              aria-label="Minimize to a button"
              title="Minimize"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-hover hover:text-ink"
            >
              <ChevronDown aria-hidden="true" className="h-4.5 w-4.5" />
            </button>
          </form>

          {/* Phones: the same line above the tabs. Tapping it opens the chat full screen, where the typing happens.
              The chats keep the ✦ button above their own box instead. */}
          {ownComposer ? null : (
            <button
              type="button"
              onClick={open}
              aria-label={`Ask AI Multi: ${ready ? draft.trim() : AI_PLACEHOLDER_SHORT}`}
              className={cn(
                BAR_SHADOW,
                "fixed inset-x-3 bottom-[calc(3.9375rem+max(0.5rem,env(safe-area-inset-bottom)))] z-30 flex h-14 items-center gap-2 rounded-full border border-line bg-raised pl-4 pr-1.5 text-left lg:hidden",
              )}
            >
              <AiSpark />
              <span className={cn("min-w-0 flex-1 truncate text-sm", ready ? "text-ink" : "text-muted")}>{ready ? draft.trim() : AI_PLACEHOLDER_SHORT}</span>
              <span aria-hidden="true" className={cn(sendButtonClass(ready), "h-11 w-11")}>
                <ArrowUp className="h-5 w-5" strokeWidth={2.25} />
              </span>
            </button>
          )}
        </>
      ) : null}
    </>
  );
}
