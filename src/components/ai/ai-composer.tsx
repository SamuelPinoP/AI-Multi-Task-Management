"use client";

import { ArrowUp } from "lucide-react";
import { useSyncExternalStore, type Ref } from "react";
import { useAiChat } from "@/components/ai/ai-chat-provider";
import { GrowingTextarea } from "@/components/ui/growing-textarea";
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

/**
 * The text of the AI's message boxes, the chat's and the bar's: 15 px (16 px on phones, globals.css,
 * so iOS doesn't zoom in when it's tapped) in 24 px lines, 4 px above and below. They grow up to 6
 * lines on a phone and 8 on wider screens, never past 40% of the screen's height, then scroll
 * (#569). ChatGPT stops at 8 lines and Gemini at 7; the chats' box goes to 10 on a computer, but
 * the AI's chat is a smaller window, and the bar floats over the page.
 */
export const AI_TEXT_CLASS =
  "max-h-[min(calc(6lh+0.5rem),40dvh)] py-1 text-[0.9375rem] leading-6 sm:max-h-[min(calc(8lh+0.5rem),40dvh)]";

const TEXT_CLASS = cn(AI_TEXT_CLASS, "px-0.5");

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
      <GrowingTextarea
        ref={ref}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (!sendsChatMessage(event.nativeEvent, window.matchMedia("(pointer: coarse)").matches)) return;
          event.preventDefault();
          ask(draft);
        }}
        maxLength={MAX_MESSAGE_CHARS}
        aria-label="Message the AI"
        placeholder={placeholder}
        wrapperClassName="flex-1 self-center"
        textClassName={TEXT_CLASS}
        className="min-h-[calc(1lh+0.5rem)] border-0 bg-transparent text-ink outline-none placeholder:text-muted"
      />
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

/**
 * The line under the message box, on the AI page and in the bar's chat (Samuel, November 21): the
 * reminder on the left, lined up with the box's text, and today's allowance on the right, lined up
 * with the send button. Phones get the shorter reminder so both fit on one line; on a narrower
 * screen the allowance wraps and stays on the right.
 */
export function AiFooter({ allowance, className }: { allowance: string | null; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-baseline gap-x-3 gap-y-0.5 pb-2.5 pl-3.5 pr-2 pt-1.5 text-[0.71875rem] leading-4 text-muted", className)}>
      <p className="min-w-0">
        <span className="sm:hidden">Nothing changes until you confirm</span>
        <span className="max-sm:hidden">Answers can be wrong. Nothing changes until you confirm it.</span>
      </p>
      {allowance ? <p className="ml-auto whitespace-nowrap tabular-nums">{allowance}</p> : null}
    </div>
  );
}
