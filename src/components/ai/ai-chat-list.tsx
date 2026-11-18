"use client";

import { useId } from "react";
import { useAiChat, type AiChat } from "@/components/ai/ai-chat-provider";
import { useUserTimeZone } from "@/components/user-time-zone";
import { chatGroups } from "@/lib/ai/chat-client";
import { MAX_CHATS } from "@/lib/ai/chat-limits";
import { cn } from "@/lib/cn";

/**
 * The person's chats (#452), grouped by the day of their latest message in their time zone, as the
 * round-2 canvas shows them: Today, Yesterday, Previous 7 days, Previous 30 days, Older. The AI
 * page's column and the AI bar's chat history both show it. Chats exist only in the browser (they
 * arrive after the page has loaded), so the day it reads is always the browser's, never the server's.
 */
export function AiChatList({ chats, emptyText, onOpen }: { chats: AiChat[]; emptyText?: string; onOpen: (id: string) => void }) {
  const { current, listState, loadChats } = useAiChat();
  const timeZone = useUserTimeZone();
  const id = useId();

  if (!chats.length) {
    if (listState === "error") {
      return (
        <p className="px-2 py-3 text-xs text-muted">
          Your chats didn&apos;t load.{" "}
          <button type="button" onClick={loadChats} className="font-semibold text-accent underline-offset-2 hover:underline">
            Try again
          </button>
        </p>
      );
    }
    const text = emptyText ?? (listState === "ready" ? "Your chats will show here." : "Loading your chats…");
    return <p className="px-2 py-3 text-xs text-muted">{text}</p>;
  }

  return (
    <div className="grid grid-cols-1 gap-3">
      {chatGroups(chats, timeZone).map((group, index) => (
        <div key={group.label}>
          <p id={`${id}-${index}`} className="px-2 pb-1 text-xs font-medium text-muted">
            {group.label}
          </p>
          {/* grid-cols-1: an auto column would grow to the longest title and push it past the list. */}
          <ul aria-labelledby={`${id}-${index}`} className="grid grid-cols-1 gap-px">
            {group.chats.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onOpen(item.id)}
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
        </div>
      ))}
    </div>
  );
}

/** Under each list of chats: how many are kept (the round-2 canvas's words). */
export const KEPT_CHATS_TEXT = `Your last ${MAX_CHATS} chats are kept.`;
