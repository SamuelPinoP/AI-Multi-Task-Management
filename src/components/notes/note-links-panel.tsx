"use client";

import { CalendarClock, Check, FileText, Link2, Plus, SquareCheckBig } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "@/components/ui/toaster";
import { cn } from "@/lib/cn";
import { formatEventDateTime } from "@/lib/event-time";

type Links = {
  tasks: Array<{ id: string; title: string; status: "TODO" | "IN_PROGRESS" | "DONE" }>;
  event: { id: string; title: string; startTime: string } | null;
  events: Array<{ id: string; title: string; startTime: string }>;
  links: Array<{ title: string; note: { id: string; title: string } | null }>;
  backlinks: Array<{ id: string; title: string }>;
};

const controlClass =
  "min-w-0 max-w-full rounded-lg border border-line bg-surface px-2 py-1 text-xs text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/25";

function Group({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  const id = `note-links-${title.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <section aria-labelledby={id} className="grid gap-1">
      <h3 id={id} className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
        {icon}
        {title}
      </h3>
      <ul className="grid gap-0.5">{children}</ul>
    </section>
  );
}

/**
 * A note's connections (SMART-05): the event it's for, tasks made from it,
 * the notes it links to with [[title]], and the notes that link back.
 * `version` changes whenever the note is saved, so the lists stay current.
 */
export function NoteLinksPanel({
  noteId,
  version,
  onOpenNote,
  onCreateNote,
}: {
  noteId: string;
  version: string;
  onOpenNote: (id: string) => void;
  onCreateNote: (title: string) => void;
}) {
  const [links, setLinks] = useState<Links | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch(`/api/notes/${noteId}/links`);
        if (response.ok && !cancelled) setLinks((await response.json()) as Links);
      } catch {
        // The panel stays as it was; the note itself still works.
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [noteId, version]);

  async function setEvent(eventId: string) {
    setBusy(true);
    try {
      const response = await fetch(`/api/notes/${noteId}/event`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId: eventId || null }),
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? "Could not change the event.");
      setLinks((current) => (current ? { ...current, event: current.events.find((event) => event.id === eventId) ?? null } : current));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not change the event.");
    } finally {
      setBusy(false);
    }
  }

  if (!links) return null;
  const empty = !links.tasks.length && !links.links.length && !links.backlinks.length;

  return (
    <div className="grid gap-3 border-t border-line pt-3 text-sm">
      <label className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <CalendarClock aria-hidden="true" className="h-3.5 w-3.5" />
        Notes for event
        <select value={links.event?.id ?? ""} onChange={(event) => void setEvent(event.target.value)} disabled={busy} className={controlClass}>
          <option value="">No event</option>
          {links.events.map((event) => (
            <option key={event.id} value={event.id}>
              {event.title} · {formatEventDateTime(event.startTime)}
            </option>
          ))}
        </select>
      </label>

      {links.tasks.length ? (
        <Group title="Tasks from this note" icon={<SquareCheckBig aria-hidden="true" className="h-3.5 w-3.5" />}>
          {links.tasks.map((task) => (
            <li key={task.id} className="flex items-center gap-2">
              <span aria-hidden="true" className={cn("grid h-3.5 w-3.5 place-items-center rounded-full border", task.status === "DONE" ? "border-accent bg-accent text-accent-ink" : "border-muted")}>
                {task.status === "DONE" ? <Check className="h-2.5 w-2.5" /> : null}
              </span>
              <Link href={`/tasks?task=${task.id}`} className={cn("truncate hover:text-accent", task.status === "DONE" && "text-muted line-through")}>
                {task.title}
              </Link>
            </li>
          ))}
        </Group>
      ) : null}

      {links.links.length ? (
        <Group title="Links" icon={<Link2 aria-hidden="true" className="h-3.5 w-3.5" />}>
          {links.links.map((link) =>
            link.note ? (
              <li key={link.title}>
                <button type="button" onClick={() => onOpenNote(link.note!.id)} className="truncate text-left text-accent hover:underline">
                  {link.note.title}
                </button>
              </li>
            ) : (
              <li key={link.title} className="flex items-center gap-2 text-muted">
                <span className="truncate">{link.title}</span>
                <button
                  type="button"
                  onClick={() => onCreateNote(link.title)}
                  aria-label={`Create the note ${link.title}`}
                  className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 text-xs font-semibold text-accent hover:bg-accent-soft"
                >
                  <Plus aria-hidden="true" className="h-3 w-3" />
                  Create
                </button>
              </li>
            ),
          )}
        </Group>
      ) : null}

      {links.backlinks.length ? (
        <Group title="Linked from" icon={<FileText aria-hidden="true" className="h-3.5 w-3.5" />}>
          {links.backlinks.map((note) => (
            <li key={note.id}>
              <button type="button" onClick={() => onOpenNote(note.id)} className="truncate text-left text-accent hover:underline">
                {note.title || "Untitled note"}
              </button>
            </li>
          ))}
        </Group>
      ) : null}

      {empty ? (
        <p className="text-xs text-muted">
          Type <code className="rounded bg-canvas px-1">[[Note title]]</code> to link another note, or select text and turn it into a task.
        </p>
      ) : null}
    </div>
  );
}
