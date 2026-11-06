"use client";

import {
  ArrowRightLeft,
  CalendarDays,
  CircleCheck,
  FolderInput,
  MoreHorizontal,
  Pencil,
  Plus,
  Tag,
  Trash2,
  Type,
  UserRound,
  Flag,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { uiPrimaryButtonClass } from "@/components/ui";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toaster";
import { cn } from "@/lib/cn";
import { paletteColor } from "@/lib/project-color";
import { COMMENT_MAX, describeTaskEvent, type TaskEventKind } from "@/lib/task-history";

type Comment = { id: string; body: string; createdAt: string; editedAt: string | null; author: { id: string; name: string }; mine: boolean };
type HistoryEvent = { id: string; kind: TaskEventKind; fromValue: string | null; toValue: string | null; createdAt: string; actor: string };
type Activity = { comments: Comment[]; events: HistoryEvent[]; canComment: boolean };
type Filter = "ALL" | "COMMENTS" | "HISTORY";

const EVENT_ICONS: Record<TaskEventKind, LucideIcon> = {
  CREATED: Plus,
  STATUS: CircleCheck,
  PRIORITY: Flag,
  ASSIGNEE: UserRound,
  DUE_DATE: CalendarDays,
  PROJECT: FolderInput,
  LABEL_ADDED: Tag,
  LABEL_REMOVED: Tag,
  TITLE: Type,
  DESCRIPTION: ArrowRightLeft,
};

const filters: [Filter, string][] = [
  ["ALL", "All"],
  ["COMMENTS", "Comments"],
  ["HISTORY", "History"],
];

/** "just now", "5 min ago", "3 h ago", "yesterday", then the date. */
function timeAgo(value: string) {
  const seconds = Math.round((Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 45) return "just now";
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: "auto", style: "short" });
  if (seconds < 3600) return format.format(-Math.round(seconds / 60), "minute");
  if (seconds < 86_400) return format.format(-Math.round(seconds / 3600), "hour");
  if (seconds < 2 * 86_400) return format.format(-1, "day");
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Plain text with web addresses made into links. */
function withLinks(text: string): ReactNode[] {
  return text.split(/(https?:\/\/[^\s<>"]+)/g).map((part, index) =>
    /^https?:\/\//.test(part) ? (
      <a key={index} href={part} target="_blank" rel="noopener noreferrer" className="break-all text-accent underline underline-offset-2">
        {part}
      </a>
    ) : (
      part
    ),
  );
}

function Avatar({ name, id, small = false }: { name: string; id: string; small?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn("grid shrink-0 place-items-center rounded-full font-bold text-white", small ? "h-5 w-5 text-[0.625rem]" : "h-7 w-7 text-xs")}
      style={{ backgroundColor: paletteColor(id) }}
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

/**
 * A task's activity (#279), as Linear shows it: comments and changes in one
 * timeline, oldest first, with a filter for either. Loads when the task opens
 * and again after `refreshKey` changes (an edit); it never polls.
 */
export function TaskActivity({ taskId, refreshKey }: { taskId: string; refreshKey?: string }) {
  const [activity, setActivity] = useState<Activity | null>(null);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Comment | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Bumped by "Try again" to load once more.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function fetchActivity() {
      try {
        const response = await fetch(`/api/tasks/${taskId}/activity`, { cache: "no-store" });
        if (!response.ok) throw new Error();
        const next = (await response.json()) as Activity;
        if (cancelled) return;
        setActivity(next);
        setError(false);
      } catch {
        if (!cancelled) setError(true);
      }
    }
    void fetchActivity();
    return () => {
      cancelled = true;
    };
  }, [taskId, refreshKey, attempt]);

  async function send(event?: FormEvent) {
    event?.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const response = await fetch(`/api/tasks/${taskId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const result = (await response.json().catch(() => null)) as (Comment & { error?: string }) | null;
      if (!response.ok || !result) throw new Error(result?.error ?? "Could not add the comment.");
      setDraft("");
      setActivity((current) => (current ? { ...current, comments: [...current.comments, result] } : current));
      if (filter === "HISTORY") setFilter("ALL");
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : "Could not add the comment.");
    } finally {
      setSending(false);
    }
  }

  async function saveEdit() {
    if (!editing) return;
    const body = editing.body.trim();
    if (!body) return;
    const response = await fetch(`/api/tasks/${taskId}/comments/${editing.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    });
    const result = (await response.json().catch(() => null)) as (Comment & { error?: string }) | null;
    if (!response.ok || !result) {
      toast.error(result?.error ?? "Could not edit the comment.");
      return;
    }
    setEditing(null);
    setActivity((current) => (current ? { ...current, comments: current.comments.map((comment) => (comment.id === result.id ? result : comment)) } : current));
  }

  async function remove(comment: Comment) {
    setDeleting(true);
    const response = await fetch(`/api/tasks/${taskId}/comments/${comment.id}`, { method: "DELETE" });
    setDeleting(false);
    setConfirmDelete(null);
    if (!response.ok) {
      toast.error("Could not delete the comment.");
      return;
    }
    setActivity((current) => (current ? { ...current, comments: current.comments.filter((item) => item.id !== comment.id) } : current));
    toast.success("Comment deleted");
  }

  const items = activity
    ? [
        ...(filter === "HISTORY" ? [] : activity.comments.map((comment) => ({ type: "comment" as const, at: comment.createdAt, comment }))),
        ...(filter === "COMMENTS" ? [] : activity.events.map((event) => ({ type: "event" as const, at: event.createdAt, event }))),
      ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
    : [];

  return (
    <section aria-labelledby={`activity-${taskId}`} className="grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <h3 id={`activity-${taskId}`} className="text-sm font-semibold">
          Activity
        </h3>
        <div role="radiogroup" aria-label="Show" className="flex rounded-lg bg-sunken p-0.5">
          {filters.map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={filter === value}
              onClick={() => setFilter(value)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent",
                filter === value ? "bg-surface text-ink shadow-card" : "text-muted hover:text-ink",
              )}
            >
              {label}
              {value === "COMMENTS" && activity?.comments.length ? <span className="ml-1 font-mono tabular-nums">{activity.comments.length}</span> : null}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-danger">
          Could not load the activity.{" "}
          <button type="button" onClick={() => setAttempt((count) => count + 1)} className="font-semibold underline">
            Try again
          </button>
        </p>
      ) : activity === null ? (
        <p className="text-sm text-muted">Loading activity…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted">{filter === "COMMENTS" ? "No comments yet." : "Nothing here yet."}</p>
      ) : (
        <ol className="grid gap-1">
          {items.map((item) =>
            item.type === "event" ? (
              <li key={`e-${item.event.id}`} className="flex items-start gap-2.5 py-1 pl-1 text-[0.8125rem] text-muted">
                {(() => {
                  const Icon = EVENT_ICONS[item.event.kind];
                  return <Icon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />;
                })()}
                <span className="min-w-0 flex-1">
                  <span className="font-medium text-ink">{item.event.actor}</span> {describeTaskEvent(item.event)}
                </span>
                <time dateTime={item.event.createdAt} title={new Date(item.event.createdAt).toLocaleString()} className="shrink-0 text-xs">
                  {timeAgo(item.event.createdAt)}
                </time>
              </li>
            ) : (
              <li key={`c-${item.comment.id}`} className="my-1 rounded-xl border border-line bg-surface p-3 shadow-card">
                <div className="flex items-center gap-2 text-[0.8125rem]">
                  <Avatar name={item.comment.author.name} id={item.comment.author.id} small />
                  <span className="font-semibold">{item.comment.author.name}</span>
                  <time dateTime={item.comment.createdAt} title={new Date(item.comment.createdAt).toLocaleString()} className="text-xs text-muted">
                    {timeAgo(item.comment.createdAt)}
                    {item.comment.editedAt ? " · edited" : ""}
                  </time>
                  {item.comment.mine ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        aria-label="Comment actions"
                        className="ml-auto grid h-7 w-7 place-items-center rounded-lg text-muted outline-none hover:bg-surface-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-accent"
                      >
                        <MoreHorizontal aria-hidden="true" className="h-4 w-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => setEditing({ id: item.comment.id, body: item.comment.body })}>
                          <Pencil />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setConfirmDelete(item.comment)} className="text-danger [&_svg]:text-danger">
                          <Trash2 />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </div>
                {editing?.id === item.comment.id ? (
                  <div className="mt-2 grid gap-2">
                    <label className="sr-only" htmlFor={`edit-${item.comment.id}`}>
                      Edit comment
                    </label>
                    <textarea
                      id={`edit-${item.comment.id}`}
                      value={editing.body}
                      onChange={(event) => setEditing({ id: item.comment.id, body: event.target.value })}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) void saveEdit();
                        if (event.key === "Escape") {
                          event.stopPropagation();
                          setEditing(null);
                        }
                      }}
                      maxLength={COMMENT_MAX}
                      rows={3}
                      autoFocus
                      className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/25"
                    />
                    <div className="flex justify-end gap-2">
                      <button type="button" onClick={() => setEditing(null)} className="rounded-lg px-3 py-1.5 text-sm text-muted hover:bg-surface-hover hover:text-ink">
                        Cancel
                      </button>
                      <button type="button" onClick={() => void saveEdit()} className={cn(uiPrimaryButtonClass, "px-3 py-1.5")}>
                        Save
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="mt-1.5 whitespace-pre-wrap break-words pl-7 text-sm leading-6">{withLinks(item.comment.body)}</p>
                )}
              </li>
            ),
          )}
        </ol>
      )}

      {activity?.canComment ? (
        <form onSubmit={send} className="rounded-xl border border-line bg-surface p-2 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/25">
          <label className="sr-only" htmlFor={`comment-${taskId}`}>
            Leave a comment
          </label>
          <textarea
            id={`comment-${taskId}`}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) void send();
            }}
            maxLength={COMMENT_MAX}
            rows={2}
            placeholder="Leave a comment… Type @ and a name to mention someone"
            className="block w-full resize-y bg-transparent px-1.5 py-1 text-sm text-ink outline-none placeholder:text-muted"
          />
          <div className="flex items-center justify-between gap-2 pt-1">
            <span className="hidden text-xs text-muted sm:inline">Ctrl + Enter to send</span>
            <button type="submit" disabled={sending || !draft.trim()} className={cn(uiPrimaryButtonClass, "ml-auto px-3 py-1.5")}>
              {sending ? "Sending…" : "Comment"}
            </button>
          </div>
        </form>
      ) : activity ? (
        <p className="text-xs text-muted">Only this project&rsquo;s editors and the task&rsquo;s assignee can comment.</p>
      ) : null}

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        title="Delete this comment?"
        message="It's removed for everyone. This can't be undone."
        confirmLabel="Delete comment"
        loading={deleting}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => {
          if (confirmDelete) void remove(confirmDelete);
        }}
      />
    </section>
  );
}
