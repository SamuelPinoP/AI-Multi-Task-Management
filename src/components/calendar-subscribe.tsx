"use client";

import { CalendarPlus, Copy } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { uiButtonClass, uiDangerButtonClass, uiPrimaryButtonClass } from "@/components/ui";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toaster";

const subscribeNever = () => () => {};

/**
 * "Subscribe" on the calendar page (SMART-09): a private link that Google,
 * Apple and Outlook calendars can subscribe to, showing events and due tasks.
 */
export function CalendarSubscribe() {
  const [open, setOpen] = useState(false);
  // undefined: not loaded yet; null: off.
  const [path, setPath] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<"replace" | "off" | null>(null);
  const origin = useSyncExternalStore(subscribeNever, () => window.location.origin, () => "");
  const url = path ? `${origin}${path}` : "";
  const webcalUrl = url.replace(/^https?:/, "webcal:");

  async function load() {
    try {
      const response = await fetch("/api/calendar-feed", { cache: "no-store" });
      if (!response.ok) throw new Error();
      setPath(((await response.json()) as { path: string | null }).path);
    } catch {
      toast.error("Couldn't load your calendar link.");
      setPath(null);
    }
  }

  async function change(method: "POST" | "DELETE") {
    setBusy(true);
    try {
      const response = await fetch("/api/calendar-feed", { method });
      const body = (await response.json().catch(() => null)) as { path?: string | null; error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? "Couldn't change the calendar link.");
      setPath(body?.path ?? null);
      if (method === "DELETE") toast.success("Calendar link turned off", { description: "Calendars using it stop updating." });
      else if (confirm === "replace") toast.success("New calendar link ready", { description: "The old link no longer works." });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't change the calendar link.");
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied");
    } catch {
      toast.error("Couldn't copy. Select the link and copy it instead.");
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          if (path === undefined) void load();
        }}
        className={uiButtonClass}
      >
        <CalendarPlus aria-hidden="true" className="h-4 w-4" />
        Subscribe
      </button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setConfirm(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-xl">Add to your calendar</DialogTitle>
            <DialogDescription>
              Subscribe from Google Calendar, Apple Calendar or Outlook to see your events and due tasks there. Changes
              show up when your calendar app checks for them, usually within a few hours.
            </DialogDescription>
          </DialogHeader>

          {path === undefined ? (
            <p className="text-sm text-muted">Loading...</p>
          ) : path === null ? (
            <button type="button" onClick={() => void change("POST")} disabled={busy} className={`${uiPrimaryButtonClass} justify-self-start`}>
              <CalendarPlus aria-hidden="true" className="h-4 w-4" />
              {busy ? "Creating..." : "Create my calendar link"}
            </button>
          ) : (
            <div className="grid gap-4">
              <label className="grid gap-1.5 text-sm font-medium">
                Calendar link
                <input
                  readOnly
                  value={url || path}
                  onFocus={(event) => event.target.select()}
                  className="w-full rounded-lg border border-line bg-sunken px-3 py-2 font-mono text-xs text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/25"
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => void copy()} className={uiPrimaryButtonClass}>
                  <Copy aria-hidden="true" className="h-4 w-4" />
                  Copy link
                </button>
                <a href={webcalUrl || path} className={uiButtonClass}>
                  Open in Apple Calendar or Outlook
                </a>
              </div>
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
                <li>
                  <span className="font-medium text-ink">Google Calendar:</span> on a computer, next to &ldquo;Other
                  calendars&rdquo; choose + and then &ldquo;From URL&rdquo;, and paste the link.
                </li>
                <li>
                  <span className="font-medium text-ink">Apple Calendar or Outlook:</span> use the button above, or add
                  a calendar subscription &ldquo;from the internet&rdquo; and paste the link.
                </li>
              </ul>
              <p className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-ink">
                Anyone with this link can see your events and due tasks. Keep it private. If it gets out, make a new one.
              </p>

              {confirm ? (
                <div role="group" aria-label="Confirm" className="grid gap-3 rounded-lg border border-line p-3">
                  <p className="text-sm">
                    {confirm === "off"
                      ? "Turn off the link? Calendars that use it stop updating."
                      : "Make a new link? The current one stops working, so calendars that use it need the new link."}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void change(confirm === "off" ? "DELETE" : "POST")}
                      disabled={busy}
                      className={uiDangerButtonClass}
                    >
                      {busy ? "Working..." : confirm === "off" ? "Turn off" : "Make a new link"}
                    </button>
                    <button type="button" onClick={() => setConfirm(null)} disabled={busy} className={uiButtonClass}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => setConfirm("replace")} className={uiButtonClass}>
                    New link
                  </button>
                  <button type="button" onClick={() => setConfirm("off")} className={uiButtonClass}>
                    Turn off
                  </button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
