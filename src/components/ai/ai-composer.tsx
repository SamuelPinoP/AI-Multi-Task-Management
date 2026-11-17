"use client";

import { ArrowUp } from "lucide-react";
import { useSyncExternalStore, type Ref } from "react";
import { useAiChat } from "@/components/ai/ai-chat-provider";
import { MAX_MESSAGE_CHARS } from "@/lib/ai/chat-limits";
import { cn } from "@/lib/cn";
import { sendsChatMessage } from "@/lib/shortcuts";

/** The placeholder Samuel picked on the round-3 canvas; phones get a shorter one. */
export const AI_PLACEHOLDER = "Create a task, ask anything, or create an event";
export const AI_PLACEHOLDER_SHORT = "Create a task, ask, or create an event";

const NARROW_QUERY = "(max-width: 639px)";

/** True below Tailwind's `sm`, where the placeholder is the short one; false on the server. */
function useNarrowScreen() {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(NARROW_QUERY);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => window.matchMedia(NARROW_QUERY).matches,
    () => false,
  );
}

// Like the project chat's box: the textarea and an invisible copy of its text share one grid cell,
// so the copy sets the height. It grows up to 6 lines, then scrolls. 15 px text, 16 px on phones
// (globals.css), so iOS doesn't zoom in when it's tapped.
const TEXT_CLASS = "col-start-1 row-start-1 max-h-[calc(6lh+0.5rem)] px-0.5 py-1 text-[0.9375rem] leading-6";

/**
 * The AI chat's message box (#308) with its send button, which is gray until something is typed
 * and then takes the accent's gradient (the round-3 "Gradient" look, `.ai-send` in globals.css).
 * Enter sends and Shift+Enter starts a new line, as in the project chat (#303). The draft is the
 * chat's, so it follows the conversation wherever it shows.
 */
export function AiComposer({ className, ref }: { className?: string; ref?: Ref<HTMLTextAreaElement> }) {
  const { draft, setDraft, ask, busy } = useAiChat();
  const placeholder = useNarrowScreen() ? AI_PLACEHOLDER_SHORT : AI_PLACEHOLDER;
  const ready = draft.trim().length > 0;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        ask(draft);
      }}
      className={cn(
        "flex items-end gap-1.5 rounded-[1.125rem] border border-line bg-surface py-2 pl-3.5 pr-2 transition-[border-color,box-shadow] focus-within:border-accent/45 focus-within:ring-[3px] focus-within:ring-accent/15",
        className,
      )}
    >
      <div className="grid min-w-0 flex-1 grid-cols-1 self-center">
        <textarea
          ref={ref}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (!sendsChatMessage(event.nativeEvent, window.matchMedia("(pointer: coarse)").matches)) return;
            event.preventDefault();
            ask(draft);
          }}
          rows={1}
          maxLength={MAX_MESSAGE_CHARS}
          aria-label="Message the AI"
          placeholder={placeholder}
          className={cn(TEXT_CLASS, "min-h-[calc(1lh+0.5rem)] w-full resize-none border-0 bg-transparent text-ink outline-none placeholder:text-muted")}
        />
        {/* The trailing space gives a final empty line its height. */}
        <div aria-hidden="true" className={cn(TEXT_CLASS, "invisible overflow-hidden whitespace-pre-wrap break-words")}>
          {`${draft} `}
        </div>
      </div>
      <button
        type="submit"
        aria-label="Send"
        title="Send"
        disabled={busy}
        className={cn(
          "grid h-9 w-9 shrink-0 place-items-center rounded-full transition-[background-color,color,box-shadow] duration-150 disabled:cursor-default disabled:opacity-60 motion-reduce:transition-none max-sm:h-11 max-sm:w-11",
          ready ? "ai-send" : "cursor-default bg-sunken text-muted",
        )}
      >
        <ArrowUp aria-hidden="true" className="h-4.5 w-4.5" strokeWidth={2.25} />
      </button>
    </form>
  );
}
