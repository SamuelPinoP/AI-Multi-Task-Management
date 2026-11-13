"use client";

import { Paperclip, Search, X } from "lucide-react";
import { Fragment, useEffect, useRef, type KeyboardEvent } from "react";
import { highlightSegments, snippetAround, type ChatSearchResult, type MatchRange } from "@/lib/chat-search";
import { cn } from "@/lib/cn";

export type SearchedMessage = {
  id: string;
  message: string;
  createdAt: string;
  pinned: boolean;
  author: { name: string | null; email: string };
};

/** Text with its matches marked; `strong` for the selected message's. */
export function Highlighted({ text, ranges, strong = false }: { text: string; ranges: MatchRange[]; strong?: boolean }) {
  return highlightSegments(text, ranges).map((segment, index) =>
    segment.match ? (
      <mark key={index} className={cn("-mx-px rounded-sm px-px", strong ? "bg-search-hit-strong text-search-hit-ink" : "bg-search-hit text-ink")}>
        {segment.text}
      </mark>
    ) : (
      <Fragment key={index}>{segment.text}</Fragment>
    ),
  );
}

const optionId = (id: string) => `chat-search-option-${id}`;

/**
 * Search inside the open chat (#409, design 2B): a field, how many messages match, and
 * every match newest first with who wrote it, when, and the words around it. On a wide
 * chat it sits at the right ("side"); on a narrow one it takes the chat's place ("full").
 */
export function ChatSearchPanel({
  query,
  onQueryChange,
  results,
  messages,
  activeId,
  onPick,
  onMove,
  onEnter,
  onClose,
  focusRequest,
  currentUserEmail,
  formatTime,
  layout,
  hidden = false,
}: {
  query: string;
  onQueryChange: (query: string) => void;
  results: ChatSearchResult[];
  messages: Map<string, SearchedMessage>;
  activeId: string | null;
  onPick: (id: string) => void;
  /** 1 for the next older result, -1 for the newer one. */
  onMove: (step: 1 | -1) => void;
  onEnter: () => void;
  onClose: () => void;
  focusRequest: number;
  currentUserEmail: string;
  formatTime: (iso: string) => string;
  layout: "side" | "full";
  hidden?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const lastFocusRequest = useRef(-1);
  const searching = query.trim().length > 0;

  // The field takes the focus when search opens or Ctrl+F asks again. Back from a result,
  // it does too, except on touch screens, where that would pop the keyboard up.
  useEffect(() => {
    if (hidden) return;
    const asked = lastFocusRequest.current !== focusRequest;
    lastFocusRequest.current = focusRequest;
    if (asked || window.matchMedia("(pointer: fine)").matches) inputRef.current?.focus();
  }, [focusRequest, hidden]);

  // Keep the selected result in view as ↑ and ↓ move through a long list.
  useEffect(() => {
    if (!activeId || hidden) return;
    listRef.current?.querySelector(`#${CSS.escape(optionId(activeId))}`)?.scrollIntoView({ block: "nearest" });
  }, [activeId, hidden]);

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      onMove(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      onMove(-1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (event.shiftKey) onMove(-1);
      else onEnter();
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  }

  const count = results.length;

  return (
    <section
      aria-labelledby="chat-search-heading"
      className={cn(
        "flex min-h-0 flex-col bg-surface",
        // "side" is the chat's second column; "full" covers the chat, which stays laid out underneath and keeps its place.
        layout === "side" ? "col-start-2 row-span-3 row-start-1 w-[23rem] border-l border-line" : "absolute inset-0 z-20",
        hidden && "hidden",
      )}
    >
      <div className="flex items-center justify-between gap-2 py-2.5 pl-4 pr-2.5">
        <h2 id="chat-search-heading" className="text-sm font-bold">
          Search in this chat
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close search"
          title="Close (Esc)"
          className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-surface-hover hover:text-ink"
        >
          <X aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>
      <div className="px-4 pb-3">
        <div className="flex h-10 items-center gap-2 rounded-lg border border-line bg-surface pl-2.5 pr-1 text-muted focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/25">
          <Search aria-hidden="true" className="h-4 w-4 shrink-0" />
          <input
            ref={inputRef}
            data-chat-search-field
            type="text"
            role="combobox"
            aria-label="Search in this chat"
            aria-autocomplete="list"
            aria-expanded={count > 0}
            aria-controls={count > 0 ? "chat-search-results" : undefined}
            aria-activedescendant={activeId && count > 0 ? optionId(activeId) : undefined}
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="search"
            placeholder="Search in this chat"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={onKeyDown}
            className="min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-muted sm:text-sm"
          />
          {query ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                onQueryChange("");
                inputRef.current?.focus();
              }}
              className="grid h-7 w-7 shrink-0 place-items-center rounded-md hover:bg-surface-hover hover:text-ink"
            >
              <X aria-hidden="true" className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      </div>
      <p role="status" className={cn("px-4 text-xs text-muted", searching && "pb-2")}>
        {!searching ? null : count ? (
          <>
            <span className="font-semibold text-ink">{`${count} message${count === 1 ? "" : "s"}`}</span> · newest first
          </>
        ) : (
          `No messages match “${query.trim()}”.`
        )}
      </p>
      <div className="min-h-0 flex-1 overflow-y-auto border-t border-line px-2 py-1.5 [scrollbar-width:thin]">
        {count ? (
          <ul ref={listRef} id="chat-search-results" role="listbox" aria-label="Messages found" className="flex flex-col gap-0.5">
            {results.map((result) => {
              const message = messages.get(result.id);
              if (!message) return null;
              const name = message.author.name || message.author.email;
              const active = result.id === activeId;
              const snippet = message.message ? snippetAround(message.message, result.ranges) : null;
              return (
                <li
                  key={result.id}
                  id={optionId(result.id)}
                  role="option"
                  aria-selected={active}
                  // Keeps the focus in the field, so ↑ and ↓ go on working after a click.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => onPick(result.id)}
                  className={cn("flex cursor-pointer gap-2.5 rounded-xl px-2.5 py-2.5", active ? "bg-accent-soft" : "hover:bg-surface-hover")}
                >
                  <span
                    aria-hidden="true"
                    className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-zinc-900 text-2xs font-semibold uppercase text-white dark:bg-zinc-100 dark:text-zinc-900"
                  >
                    {name.slice(0, 1)}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex min-w-0 items-baseline gap-1.5">
                      <span className="truncate text-[0.8125rem] font-semibold text-ink">{name}</span>
                      {message.author.email === currentUserEmail ? (
                        <span className="shrink-0 text-2xs font-medium uppercase tracking-wide text-muted">You</span>
                      ) : null}
                      {message.pinned ? (
                        <span className="shrink-0 rounded-full bg-amber-100 px-1.5 text-2xs font-medium text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
                          Pinned
                        </span>
                      ) : null}
                      <time dateTime={message.createdAt} className="ml-auto shrink-0 font-mono text-2xs tabular-nums text-muted">
                        {formatTime(message.createdAt)}
                      </time>
                    </span>
                    {snippet ? (
                      <span className="line-clamp-2 break-words text-[0.8125rem] leading-5 text-ink">
                        <Highlighted text={snippet.text} ranges={snippet.ranges} />
                      </span>
                    ) : null}
                    {result.files.map((file) => (
                      <span key={file.id} className="flex min-w-0 items-center gap-1 text-xs text-muted">
                        <Paperclip aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">
                          <Highlighted text={file.name} ranges={file.ranges} />
                        </span>
                      </span>
                    ))}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="px-4 py-10 text-center text-sm text-muted">{searching ? "Try other words, or fewer of them." : "Type a word or phrase to find it in this chat."}</p>
        )}
      </div>
      {layout === "side" && count ? (
        <p aria-hidden="true" className="flex items-center gap-1.5 border-t border-line px-4 py-2 text-2xs text-muted pointer-coarse:hidden">
          <kbd className="rounded border border-b-2 border-line px-1 font-mono">↑</kbd>
          <kbd className="rounded border border-b-2 border-line px-1 font-mono">↓</kbd>
          <span className="mr-2">to move</span>
          <kbd className="rounded border border-b-2 border-line px-1 font-mono">Esc</kbd>
          <span>to close</span>
        </p>
      ) : null}
    </section>
  );
}
