"use client";

import Link from "next/link";
import { useEffect, useId, useRef } from "react";
import { useAiChat } from "@/components/ai/ai-chat-provider";
import { uiPrimaryButtonClass } from "@/components/ui";
import { AI_NOTICE_TEXT } from "@/lib/ai/notice";
import { cn } from "@/lib/cn";
import { PRIVACY_PATH } from "@/lib/legal";

/**
 * The data notice (#307, #308), in place of the first answer: what the assistant sends, to whom,
 * and how it may be used. Nothing is sent until the person agrees; "Not now" puts the question
 * back in the message box. Its heading takes focus, so a screen reader reads it out, and an Enter
 * still held from sending can't press "Agree and continue" by accident.
 */
export function AiNotice({ className }: { className?: string }) {
  const { notice, agree, dismissNotice } = useAiChat();
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    heading.current?.focus();
  }, []);

  return (
    <section aria-labelledby={headingId} className={cn("grid gap-2.5 rounded-xl border border-line bg-sunken p-3.5 text-[0.84375rem] leading-normal text-ink", className)}>
      <h2 ref={heading} id={headingId} tabIndex={-1} className="text-[0.9375rem] font-semibold outline-none">
        {AI_NOTICE_TEXT.title}
      </h2>
      {AI_NOTICE_TEXT.paragraphs.map((paragraph) => (
        <p key={paragraph}>{paragraph}</p>
      ))}
      {notice.error ? (
        <p role="alert" className="text-danger">
          {notice.error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={agree} disabled={notice.agreeing} className={cn(uiPrimaryButtonClass, "px-3 py-1.5 disabled:opacity-60")}>
          {notice.agreeing ? "Saving…" : "Agree and continue"}
        </button>
        <button
          type="button"
          onClick={dismissNotice}
          className="rounded-lg px-3 py-1.5 text-sm font-semibold text-muted transition-colors hover:bg-surface-hover hover:text-ink"
        >
          Not now
        </button>
        <Link href={`${PRIVACY_PATH}#ai`} className="text-xs font-medium text-accent underline-offset-2 hover:underline">
          Privacy Policy
        </Link>
      </div>
    </section>
  );
}
