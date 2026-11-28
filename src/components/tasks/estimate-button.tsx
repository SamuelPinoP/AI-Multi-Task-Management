"use client";

import { LoaderCircle } from "lucide-react";
import { AiSpark } from "@/components/ai/ai-spark";
import { usedUpNote, type EstimateButtonState } from "@/lib/ai/estimate-client";
import { cn } from "@/lib/cn";

/**
 * The Estimate button (#540, design 1A): quiet, beside "Add a section" on a task without an
 * estimate, with the AI's mark, since the AI answers. Once today's allowance is used up, it stays
 * in its place, off, and says when it's back.
 */
export function EstimateButton({ state, busy, onClick }: { state: EstimateButtonState; busy: boolean; onClick: () => void }) {
  const usedUp = state.state === "used_up";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || usedUp}
      aria-busy={busy || undefined}
      className={cn(
        "inline-flex min-h-8 w-fit items-center gap-1.5 rounded-lg px-1.5 text-left text-sm font-medium text-muted outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent max-sm:min-h-11",
        !busy && !usedUp && "hover:bg-surface-hover hover:text-accent",
      )}
    >
      {busy ? <LoaderCircle aria-hidden="true" className="h-4 w-4 shrink-0 motion-safe:animate-spin" /> : <AiSpark muted={usedUp} className="h-4 w-4" />}
      <span>
        {busy ? "Estimating…" : "Estimate"}
        {state.state === "used_up" ? (
          // The hours left depend on the clock, which moves between the server's render and the browser's.
          <span className="font-normal" suppressHydrationWarning>
            {` · ${usedUpNote(state.resetsAt, new Date())}`}
          </span>
        ) : null}
      </span>
    </button>
  );
}
