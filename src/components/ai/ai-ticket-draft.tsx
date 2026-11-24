"use client";

import { ArrowLeft, X } from "lucide-react";
import { useId, useRef } from "react";
import { useAiChat } from "@/components/ai/ai-chat-provider";
import { TaskDescription } from "@/components/tasks/task-description";
import { uiPrimaryButtonClass } from "@/components/ui";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toaster";
import { OFFLINE_MESSAGE } from "@/lib/ai/chat-client";
import type { ProposalRow, ProposalView } from "@/lib/ai/proposals";
import { cn } from "@/lib/cn";

const closeButtonClass =
  "grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted outline-none transition-colors hover:bg-surface-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-accent max-sm:h-11 max-sm:w-11";

/**
 * A new task the AI proposed, as a draft beside the chat (#433, design 2C): a ticket, or a task with
 * the AI's estimate (#434). Every section, formatted, which the person can change, fold and add to
 * before they apply the card. Full screen on a phone. Each change is saved with the proposal, so
 * it's still there after a reload; nothing in the workspace changes until Apply, which creates the
 * task with the description as it is then.
 */
export function AiTicketDraft({
  proposal,
  row,
  open,
  onOpenChange,
}: {
  proposal: ProposalView;
  row: ProposalRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { replaceProposal } = useAiChat();
  const editing = useRef(false);
  const introId = useId();
  const step = proposal.steps[row.index];
  const description = step?.kind === "create_task" ? (step.description ?? "") : "";

  async function save(next: string) {
    try {
      const response = await fetch(`/api/agent/proposals/${encodeURIComponent(proposal.id)}/draft`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step: row.index, description: next }),
      });
      const body = (await response.json().catch(() => null)) as { proposal?: ProposalView | null; error?: string } | null;
      if (body?.proposal) replaceProposal(body.proposal, response.ok ? "Draft saved." : (body.error ?? ""));
      if (!response.ok) {
        toast.error(body?.error ?? "Could not save the draft. Try again in a moment.");
        return false;
      }
      return true;
    } catch {
      toast.error(OFFLINE_MESSAGE);
      return false;
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        hideClose
        // Escape while a section is being edited cancels that edit, and keeps the draft open.
        onEscapeKeyDown={(event) => {
          if (editing.current) event.preventDefault();
        }}
        className="gap-0 overflow-hidden bg-surface p-0 sm:max-w-[32.5rem]"
      >
        <div className="flex h-14 shrink-0 items-center gap-1 border-b border-line pl-1.5 pr-2 sm:pl-5">
          <SheetClose className={cn(closeButtonClass, "sm:hidden")} aria-label="Back to the chat">
            <ArrowLeft aria-hidden="true" className="h-5 w-5" />
          </SheetClose>
          <p className="min-w-0 flex-1 truncate text-xs font-medium text-muted">{row.draft?.ticket ? "Draft ticket" : "Draft task"} · not created until you apply</p>
          <SheetClose className={cn(closeButtonClass, "max-sm:hidden")} aria-label="Close the draft">
            <X aria-hidden="true" className="h-4 w-4" />
          </SheetClose>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-4 sm:px-6">
          <SheetTitle className="text-xl font-semibold leading-7 tracking-[-0.01em] [overflow-wrap:anywhere]">{row.title}</SheetTitle>
          <SheetDescription className="mt-1 text-[0.8125rem] text-muted">{[row.verb, row.details].filter(Boolean).join(" · ")}</SheetDescription>
          <div className="mt-4">
            <TaskDescription
              description={description}
              canEdit
              onSave={save}
              variant="draft"
              headingLevel={3}
              introId={introId}
              onEditingChange={(now) => {
                editing.current = now;
              }}
            />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3 border-t border-line px-4 py-3 sm:px-5">
          <SheetClose className={cn(uiPrimaryButtonClass, "h-11 py-0 max-sm:flex-1 sm:h-9")}>
            <span className="sm:hidden">Back to the chat</span>
            <span className="max-sm:hidden">Back to the card</span>
          </SheetClose>
          <p className="text-xs text-muted max-sm:hidden">Your changes go in when you apply the card.</p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
