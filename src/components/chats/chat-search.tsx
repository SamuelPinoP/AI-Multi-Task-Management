"use client";

import { Search } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { chatHeaderIconButtonClass } from "@/components/chats/project-chat-menu";

type ChatSearchState = {
  open: boolean;
  /** Opens search, or gives its field the focus again when it's already open. */
  openSearch: () => void;
  closeSearch: () => void;
  /** Goes up each time something asks the field for the focus. */
  focusRequest: number;
  triggerRef: RefObject<HTMLButtonElement | null>;
};

const ChatSearchContext = createContext<ChatSearchState | null>(null);

/**
 * Whether the open chat's search is showing (#409), shared by the header's search button
 * and the chat below it. Ctrl+F (Cmd+F) opens it; a second one, from the search field,
 * is left to the browser's own find.
 */
export function ChatSearchProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const openSearch = useCallback(() => {
    setOpen(true);
    setFocusRequest((count) => count + 1);
  }, []);
  const closeSearch = useCallback(() => {
    setOpen(false);
    // Back to the button that opened it, as a dialog does.
    requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== "f") return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("[data-chat-search-field]")) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      event.preventDefault();
      openSearch();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openSearch]);

  const value = useMemo(() => ({ open, openSearch, closeSearch, focusRequest, triggerRef }), [open, openSearch, closeSearch, focusRequest]);
  return <ChatSearchContext.Provider value={value}>{children}</ChatSearchContext.Provider>;
}

/** The chat's search state, or null outside a ChatSearchProvider (a chat without search). */
export function useChatSearch() {
  return useContext(ChatSearchContext);
}

/** The header's search button, left of ⋯; it shows as pressed while search is open. */
export function ChatSearchButton() {
  const search = useChatSearch();
  if (!search) return null;
  const { open, openSearch, closeSearch, triggerRef } = search;
  return (
    <button
      ref={triggerRef}
      type="button"
      aria-label="Search in this chat"
      title="Search in this chat (Ctrl+F)"
      aria-pressed={open}
      onClick={() => (open ? closeSearch() : openSearch())}
      className={chatHeaderIconButtonClass}
    >
      <Search aria-hidden="true" className="h-4 w-4" />
    </button>
  );
}
