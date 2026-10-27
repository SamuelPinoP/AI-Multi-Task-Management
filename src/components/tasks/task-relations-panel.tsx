"use client";

import { Check, CornerLeftUp, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { uiButtonClass } from "@/components/ui";
import { cn } from "@/lib/cn";
import { subtaskProgress } from "@/lib/task-relations";
import { ProgressRing } from "./task-badges";
import type { RelatedTask, Task } from "./types";

const fieldClass =
  "w-full min-w-0 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/25 disabled:opacity-60";

export type TaskRelations = {
  /** The parent, when this task is a subtask. */
  parent: RelatedTask | null;
  subtasks: Task[];
  blockers: RelatedTask[];
  /** Tasks this one could wait on. */
  candidates: Task[];
  onAddSubtask: (title: string) => Promise<string | null>;
  onToggleSubtask: (task: Task) => void;
  onOpenTask: (id: string) => void;
  onAddBlocker: (id: string) => Promise<string | null>;
  onRemoveBlocker: (id: string) => Promise<string | null>;
};

/** Subtasks and "Blocked by" for one task, in its side sheet (SMART-02). */
export function TaskRelationsPanel({ task, relations }: { task: Task; relations: TaskRelations }) {
  const [subtaskTitle, setSubtaskTitle] = useState("");
  const [blockerId, setBlockerId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const progress = subtaskProgress(relations.subtasks);

  async function run(action: () => Promise<string | null>) {
    setBusy(true);
    setError(null);
    const message = await action();
    setBusy(false);
    setError(message);
    return !message;
  }

  async function addSubtask(event: FormEvent) {
    event.preventDefault();
    const title = subtaskTitle.trim();
    if (!title || busy) return;
    if (await run(() => relations.onAddSubtask(title))) setSubtaskTitle("");
  }

  async function addBlocker() {
    if (!blockerId || busy) return;
    if (await run(() => relations.onAddBlocker(blockerId))) setBlockerId("");
  }

  return (
    <div className="mt-6 grid gap-6 border-t border-line pt-5">
      {relations.parent ? (
        <p className="flex items-center gap-1.5 text-sm text-muted">
          <CornerLeftUp aria-hidden="true" className="h-4 w-4" />
          Subtask of
          <button type="button" onClick={() => relations.onOpenTask(relations.parent!.id)} className="truncate font-medium text-ink underline-offset-2 hover:text-accent hover:underline">
            {relations.parent.title}
          </button>
        </p>
      ) : (
        <section aria-labelledby="subtasks-heading" className="grid gap-2">
          <div className="flex items-center justify-between gap-2">
            <h3 id="subtasks-heading" className="text-sm font-semibold">
              Subtasks
            </h3>
            {progress.total ? <ProgressRing done={progress.done} total={progress.total} /> : null}
          </div>
          {relations.subtasks.length ? (
            <ul className="grid gap-1">
              {relations.subtasks.map((subtask) => {
                const done = subtask.status === "DONE";
                return (
                  <li key={subtask.id} className="flex items-center gap-2.5 rounded-lg px-1 py-1 hover:bg-surface-hover">
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={done}
                      aria-label={done ? `Mark ${subtask.title} as not done` : `Complete ${subtask.title}`}
                      onClick={() => relations.onToggleSubtask(subtask)}
                      className={cn(
                        "grid h-4 w-4 shrink-0 place-items-center rounded border-[1.5px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                        done ? "border-accent bg-accent text-accent-ink" : "border-muted hover:border-accent",
                      )}
                    >
                      {done ? <Check aria-hidden="true" className="h-3 w-3" /> : null}
                    </button>
                    <button
                      type="button"
                      onClick={() => relations.onOpenTask(subtask.id)}
                      className={cn("min-w-0 flex-1 truncate text-left text-sm", done ? "text-muted line-through" : "hover:text-accent")}
                    >
                      {subtask.title}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-muted">Break this task into steps you can check off.</p>
          )}
          <form onSubmit={addSubtask}>
            <label className="sr-only" htmlFor={`add-subtask-${task.id}`}>
              Add a subtask
            </label>
            <input
              id={`add-subtask-${task.id}`}
              value={subtaskTitle}
              onChange={(event) => setSubtaskTitle(event.target.value)}
              placeholder="Add a subtask and press Enter"
              maxLength={200}
              autoComplete="off"
              disabled={busy}
              className={fieldClass}
            />
          </form>
        </section>
      )}

      <section aria-labelledby="blockers-heading" className="grid gap-2">
        <div>
          <h3 id="blockers-heading" className="text-sm font-semibold">
            Blocked by
          </h3>
          <p className="text-xs text-muted">This task waits until these are done.</p>
        </div>
        {relations.blockers.length ? (
          <ul className="grid gap-1">
            {relations.blockers.map((blocker) => (
              <li key={blocker.id} className="flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-surface-hover">
                <span
                  className={cn(
                    "shrink-0 rounded px-1.5 text-2xs font-bold",
                    blocker.status === "DONE" ? "bg-success-soft text-success" : "bg-caution-soft text-caution",
                  )}
                >
                  {blocker.status === "DONE" ? "Done" : "Open"}
                </span>
                <button type="button" onClick={() => relations.onOpenTask(blocker.id)} className="min-w-0 flex-1 truncate text-left text-sm hover:text-accent">
                  {blocker.title}
                </button>
                <button
                  type="button"
                  onClick={() => void run(() => relations.onRemoveBlocker(blocker.id))}
                  disabled={busy}
                  aria-label={`Stop waiting on ${blocker.title}`}
                  className="grid h-6 w-6 shrink-0 place-items-center rounded text-muted hover:bg-surface hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                >
                  <X aria-hidden="true" className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex gap-2">
          <select
            aria-label="Add a task this one waits on"
            value={blockerId}
            onChange={(event) => setBlockerId(event.target.value)}
            disabled={busy || relations.candidates.length === 0}
            className={fieldClass}
          >
            <option value="">{relations.candidates.length ? "Pick a task this one waits on" : "No other open tasks"}</option>
            {relations.candidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.title}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => void addBlocker()} disabled={busy || !blockerId} className={cn(uiButtonClass, "shrink-0 px-3")}>
            Add
          </button>
        </div>
      </section>

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
