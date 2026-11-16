"use client";

import { type FormEvent, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toaster";
import { uiButtonClass, uiPrimaryButtonClass } from "@/components/ui";
import { FEEDBACK_MAX_LENGTH } from "@/lib/feedback-core";

const fieldClass =
  "mt-1.5 block w-full resize-none rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/25";

/**
 * Send feedback (#430), opened from the profile menu: one message box and an optional "Samuel can
 * email me about this". Sending emails the app's admins; the dialog closes with a toast.
 */
export function FeedbackDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [message, setMessage] = useState("");
  const [mayReply, setMayReply] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const changeOpen = (next: boolean) => {
    if (sending) return;
    if (!next) {
      setMessage("");
      setMayReply(false);
      setError(null);
    }
    onOpenChange(next);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!message.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, mayReply }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "Your feedback couldn't be sent. Try again in a minute.");
        return;
      }
      setMessage("");
      setMayReply(false);
      onOpenChange(false);
      toast.success("Thanks! Your feedback was sent.");
    } catch {
      setError("Your feedback couldn't be sent. Check your connection and try again.");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="max-w-md">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Send feedback</DialogTitle>
            <DialogDescription>What works, what doesn&apos;t, what you&apos;d like next. Samuel reads every message.</DialogDescription>
          </DialogHeader>
          <div>
            <label htmlFor="feedback-message" className="text-sm font-medium text-ink">
              Your feedback
            </label>
            <textarea
              id="feedback-message"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              rows={5}
              maxLength={FEEDBACK_MAX_LENGTH}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "feedback-error" : undefined}
              className={fieldClass}
            />
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={mayReply}
              onChange={(event) => setMayReply(event.target.checked)}
              className="h-4 w-4 shrink-0 accent-accent"
            />
            Samuel can email me about this
          </label>
          {error ? (
            <p id="feedback-error" role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <button type="button" className={uiButtonClass} onClick={() => changeOpen(false)} disabled={sending}>
              Cancel
            </button>
            <button type="submit" className={uiPrimaryButtonClass} disabled={!message.trim() || sending}>
              {sending ? "Sending…" : "Send feedback"}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
