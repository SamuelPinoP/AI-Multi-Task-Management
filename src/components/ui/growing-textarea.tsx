import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

type GrowingTextareaProps = Omit<ComponentProps<"textarea">, "value" | "rows"> & {
  value: string;
  /** What the box and its fallback copy share: font size, line height, padding and the `max-h-*` limit. */
  textClassName: string;
  /** The grid both sit in, for its place in the row (`flex-1`, padding). */
  wrapperClassName?: string;
};

/**
 * A message box that grows with its text, like WhatsApp's: a line at a time as the text wraps, up
 * to the `max-h-*` in `textClassName`, then it stops and scrolls inside. It shrinks back as the
 * text goes. The chats, the AI's chat and the AI bar all use it.
 *
 * It sizes itself from its own text (`field-sizing: content`), so it grows on the keystroke that
 * moves a word to a new line, and never shows a scrollbar below its limit. Before, an invisible
 * copy of the text in the same grid cell set the height. The textarea wraps a keystroke or two
 * before such a copy, and on Windows the scrollbar that then appeared took 15 px from the text: the
 * box stayed a line short, its first line hidden, until the copy wrapped too. Browsers without
 * field-sizing (before Chrome 123, Safari 26.2 and Firefox 152) still get the copy.
 */
export function GrowingTextarea({ textClassName, wrapperClassName, className, value, ...props }: GrowingTextareaProps) {
  return (
    <div className={cn("grid min-w-0 grid-cols-1", wrapperClassName)}>
      <textarea
        {...props}
        value={value}
        rows={1}
        // The hint stays on one line, as before: a box sized by its content would otherwise make
        // room for a hint that wraps on a narrow phone, then jump back to one line at the first key.
        className={cn(
          "col-start-1 row-start-1 w-full resize-none overflow-y-auto [field-sizing:content] placeholder:truncate",
          textClassName,
          className,
        )}
      />
      {/* The fallback's copy. The trailing space gives a final empty line its height. */}
      <div
        aria-hidden="true"
        className={cn(
          "invisible col-start-1 row-start-1 overflow-hidden whitespace-pre-wrap break-words supports-[field-sizing:content]:hidden",
          textClassName,
        )}
      >
        {`${value} `}
      </div>
    </div>
  );
}
