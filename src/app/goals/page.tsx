"use client";

/**
 * Goals and the weekly review (SMART-04).
 *
 * - Set a few goals for a week and link the tasks that move them.
 * - The review shows what got done, what slipped and what's next, and
 *   carries unfinished work to next week with one click.
 * - `?week=2026-W43` opens another week.
 */

import { ArrowRight, Check, ChevronLeft, ChevronRight, Target, Trash2, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { uiButtonClass, uiCardClass, uiPrimaryButtonClass } from "@/components/ui";
import { toast } from "@/components/ui/toaster";
import { cn } from "@/lib/cn";
import type { GoalsWeek } from "@/lib/goals";
import { useRefreshOnReturn } from "@/lib/use-page-activity";
import { notifyWorkspaceChanged } from "@/lib/workspace-events";

type Goal = GoalsWeek["goals"][number];
type WeekTask = Goal["tasks"][number];

const fieldClass =
  "w-full min-w-0 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/25 disabled:opacity-60";

async function send(url: string, method: string, body?: unknown) {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok) throw new Error(data?.error ?? "Something went wrong. Try again.");
  return data;
}

function TaskLine({ task, aside }: { task: WeekTask; aside?: ReactNode }) {
  const done = task.status === "DONE";
  return (
    <li className="flex items-center gap-2 py-1 text-sm">
      <span
        aria-hidden="true"
        className={cn("grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full border", done ? "border-accent bg-accent text-accent-ink" : "border-muted")}
      >
        {done ? <Check className="h-2.5 w-2.5" /> : null}
      </span>
      <Link href={`/tasks?task=${task.id}`} className={cn("relative min-w-0 flex-1 truncate hover:text-accent", done && "text-muted line-through")}>
        {task.title}
        <span className="sr-only">{done ? " (done)" : " (open)"}</span>
      </Link>
      {aside}
    </li>
  );
}

function GoalCard({
  goal,
  candidates,
  onChanged,
}: {
  goal: Goal;
  candidates: GoalsWeek["candidates"];
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [newTask, setNewTask] = useState("");
  const [linkId, setLinkId] = useState("");
  const achieved = goal.status === "COMPLETED";
  const done = goal.tasks.filter((task) => task.status === "DONE").length;
  const percent = goal.tasks.length ? Math.round((done / goal.tasks.length) * 100) : 0;

  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    try {
      await action();
      notifyWorkspaceChanged();
      await onChanged();
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Something went wrong.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function addTask(event: FormEvent) {
    event.preventDefault();
    const title = newTask.trim();
    if (!title) return;
    if (await act(() => send(`/api/goals/${goal.id}/tasks`, "POST", { title }))) setNewTask("");
  }

  return (
    <li className={cn(uiCardClass, "grid grid-cols-1 gap-3 p-4")}>
      <div className="flex items-start gap-3">
        <button
          type="button"
          role="checkbox"
          aria-checked={achieved}
          aria-label={achieved ? `Mark ${goal.title} as not achieved` : `Mark ${goal.title} as achieved`}
          disabled={busy}
          onClick={() => void act(() => send(`/api/goals/${goal.id}`, "PATCH", { status: achieved ? "ACTIVE" : "COMPLETED" }))}
          className={cn(
            "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
            achieved ? "border-accent bg-accent text-accent-ink" : "border-muted hover:border-accent",
          )}
        >
          {achieved ? <Check aria-hidden="true" className="h-3 w-3" /> : null}
        </button>
        <div className="min-w-0 flex-1">
          <h3 className={cn("font-semibold", achieved && "text-muted line-through")}>{goal.title}</h3>
          <p className="text-xs text-muted">
            {goal.tasks.length ? `${done} of ${goal.tasks.length} linked tasks done` : "No tasks linked yet"}
            {achieved ? " · Achieved" : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void act(() => send(`/api/goals/${goal.id}`, "DELETE"))}
          disabled={busy}
          aria-label={`Delete goal ${goal.title}`}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface-hover hover:text-danger focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        >
          <Trash2 aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>
      {goal.tasks.length ? (
        <>
          <div
            className="h-1.5 overflow-hidden rounded-full bg-accent-soft"
            role="progressbar"
            aria-label={`${goal.title} progress`}
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="h-full rounded-full bg-accent" style={{ width: `${percent}%` }} />
          </div>
          <ul>
            {goal.tasks.map((task) => (
              <TaskLine
                key={task.id}
                task={task}
                aside={
                  <button
                    type="button"
                    onClick={() => void act(() => send(`/api/goals/${goal.id}/tasks/${task.id}`, "DELETE"))}
                    disabled={busy}
                    aria-label={`Unlink ${task.title}`}
                    className="grid h-6 w-6 shrink-0 place-items-center rounded text-muted hover:bg-surface-hover hover:text-ink"
                  >
                    <X aria-hidden="true" className="h-3.5 w-3.5" />
                  </button>
                }
              />
            ))}
          </ul>
        </>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-2">
        <form onSubmit={addTask}>
          <label className="sr-only" htmlFor={`goal-task-${goal.id}`}>
            New task for {goal.title}
          </label>
          <input
            id={`goal-task-${goal.id}`}
            value={newTask}
            onChange={(event) => setNewTask(event.target.value)}
            placeholder="Add a new task and press Enter"
            maxLength={200}
            autoComplete="off"
            disabled={busy}
            className={fieldClass}
          />
        </form>
        <div className="flex gap-2">
          <select
            aria-label={`Link a task to ${goal.title}`}
            value={linkId}
            onChange={(event) => setLinkId(event.target.value)}
            disabled={busy || candidates.length === 0}
            className={fieldClass}
          >
            <option value="">{candidates.length ? "Link an open task" : "No open tasks to link"}</option>
            {candidates.map((task) => (
              <option key={task.id} value={task.id}>
                {task.title}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={busy || !linkId}
            onClick={() => void act(() => send(`/api/goals/${goal.id}/tasks`, "POST", { taskId: linkId })).then((ok) => ok && setLinkId(""))}
            className={cn(uiButtonClass, "shrink-0 px-3")}
          >
            Link
          </button>
        </div>
      </div>
    </li>
  );
}

function ReviewColumn({ title, count, empty, children }: { title: string; count: number; empty: string; children: ReactNode }) {
  const id = `review-${title.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <section aria-labelledby={id} className="rounded-xl border border-line bg-surface p-4 shadow-card">
      <h3 id={id} className="flex items-center gap-2 text-sm font-semibold">
        {title}
        <span className="text-xs font-normal text-muted">{count}</span>
      </h3>
      {count ? <ul className="mt-2">{children}</ul> : <p className="mt-2 text-sm text-muted">{empty}</p>}
    </section>
  );
}

function GoalLine({ goal }: { goal: Goal }) {
  return (
    <li className="flex items-center gap-2 py-1 text-sm">
      <Target aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-accent" />
      <span className="min-w-0 flex-1 truncate">
        <span className="sr-only">Goal: </span>
        {goal.title}
      </span>
    </li>
  );
}

export default function GoalsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requestedWeek = searchParams.get("week") ?? "";
  const [data, setData] = useState<GoalsWeek | null>(null);
  const [loadError, setLoadError] = useState("");
  const [newGoal, setNewGoal] = useState("");
  const [saving, setSaving] = useState(false);

  async function load(week = data?.week.key ?? requestedWeek) {
    try {
      const response = await fetch(`/api/goals${week ? `?week=${encodeURIComponent(week)}` : ""}`);
      if (!response.ok) throw new Error();
      setData((await response.json()) as GoalsWeek);
      setLoadError("");
    } catch {
      setLoadError("Could not load your goals.");
    }
  }

  useEffect(() => {
    async function loadWeek() {
      try {
        const response = await fetch(`/api/goals${requestedWeek ? `?week=${encodeURIComponent(requestedWeek)}` : ""}`);
        if (!response.ok) throw new Error();
        setData((await response.json()) as GoalsWeek);
        setLoadError("");
      } catch {
        setLoadError("Could not load your goals.");
      }
    }
    void loadWeek();
  }, [requestedWeek]);

  // Goals and their tasks changed on another device show up on coming back.
  useRefreshOnReturn(() => void load());

  function goToWeek(key: string) {
    router.replace(`${pathname}?week=${key}`, { scroll: false });
  }

  async function addGoal(event: FormEvent) {
    event.preventDefault();
    const title = newGoal.trim();
    if (!title || !data || saving) return;
    setSaving(true);
    try {
      await send("/api/goals", "POST", { title, targetWeek: data.week.key });
      setNewGoal("");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not add the goal.");
    } finally {
      setSaving(false);
    }
  }

  async function carryForward() {
    if (!data) return;
    setSaving(true);
    try {
      const result = (await send("/api/goals/carry-forward", "POST", { week: data.week.key })) as { tasks: number; goals: number };
      notifyWorkspaceChanged();
      await load();
      const parts = [
        result.tasks ? `${result.tasks} task${result.tasks === 1 ? "" : "s"}` : "",
        result.goals ? `${result.goals} goal${result.goals === 1 ? "" : "s"}` : "",
      ].filter(Boolean);
      toast.success(parts.length ? `Moved ${parts.join(" and ")} to next week` : "Nothing to move");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not move the work.");
    } finally {
      setSaving(false);
    }
  }

  const review = data?.review;
  const leftover = review ? review.slipped.length + review.openGoals.length : 0;

  return (
    <div className="mx-auto grid w-full grid-cols-1 max-w-5xl gap-5 px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-title">Goals</h1>
          <p className="mt-0.5 text-sm text-muted">Pick a few goals for the week, link the tasks that move them, and review on Friday.</p>
        </div>
        {data ? (
          <nav aria-label="Week" className="flex items-center gap-1">
            <button type="button" onClick={() => goToWeek(data.week.previous)} aria-label="Previous week" className={cn(uiButtonClass, "px-2 py-1.5")}>
              <ChevronLeft aria-hidden="true" className="h-4 w-4" />
            </button>
            <p className="min-w-36 text-center text-sm font-semibold" aria-live="polite">
              {data.week.label}
              <span className="block text-xs font-normal text-muted">{data.week.isCurrent ? "This week" : data.week.key}</span>
            </p>
            <button type="button" onClick={() => goToWeek(data.week.next)} aria-label="Next week" className={cn(uiButtonClass, "px-2 py-1.5")}>
              <ChevronRight aria-hidden="true" className="h-4 w-4" />
            </button>
            {data.week.isCurrent ? null : (
              <button type="button" onClick={() => router.replace(pathname, { scroll: false })} className={cn(uiButtonClass, "ml-1 px-3 py-1.5")}>
                This week
              </button>
            )}
          </nav>
        ) : null}
      </header>

      {loadError ? (
        <p role="alert" className="rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          {loadError}{" "}
          <button type="button" onClick={() => void load()} className="font-semibold underline">
            Try again
          </button>
        </p>
      ) : null}

      {!data ? (
        <div className="grid gap-2" aria-busy="true" aria-label="Loading goals">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="h-20 animate-pulse rounded-xl border border-line bg-surface" />
          ))}
        </div>
      ) : (
        <>
          <section aria-labelledby="goals-heading" className="grid grid-cols-1 gap-3">
            <h2 id="goals-heading" className="text-lg font-semibold">
              Goals for {data.week.isCurrent ? "this week" : data.week.label}
            </h2>
            <form onSubmit={addGoal} className="flex gap-2">
              <label htmlFor="new-goal" className="sr-only">
                Add a goal for this week
              </label>
              <input
                id="new-goal"
                value={newGoal}
                onChange={(event) => setNewGoal(event.target.value)}
                placeholder="Add a goal, e.g. Ship the beta"
                maxLength={200}
                autoComplete="off"
                disabled={saving}
                className={fieldClass}
              />
              <button type="submit" disabled={saving || !newGoal.trim()} className={cn(uiPrimaryButtonClass, "shrink-0 px-3")}>
                Add goal
              </button>
            </form>
            {data.goals.length ? (
              <ul className="grid grid-cols-1 gap-3">
                {data.goals.map((goal) => (
                  <GoalCard key={goal.id} goal={goal} candidates={data.candidates} onChanged={() => load()} />
                ))}
              </ul>
            ) : (
              <p className="rounded-xl border border-dashed border-line bg-surface px-4 py-6 text-center text-sm text-muted">
                No goals for this week yet. Two or three is plenty.
              </p>
            )}
          </section>

          {review ? (
            <section aria-labelledby="review-heading" className="grid grid-cols-1 gap-3">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 id="review-heading" className="text-lg font-semibold">
                    Weekly review
                  </h2>
                  <p className="text-sm text-muted">
                    {data.week.reviewTime
                      ? "It's the end of the week: look back, then carry what's left to next week."
                      : "What got done, what slipped and what's next."}
                  </p>
                </div>
                <button type="button" onClick={() => void carryForward()} disabled={saving || leftover === 0} className={cn(uiPrimaryButtonClass, "px-3 py-1.5")}>
                  Carry {leftover} to next week
                  <ArrowRight aria-hidden="true" className="h-4 w-4" />
                </button>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <ReviewColumn title="Done" count={review.done.length} empty="Nothing finished yet this week.">
                  {review.done.map((task) => (
                    <TaskLine key={task.id} task={task} />
                  ))}
                </ReviewColumn>
                <ReviewColumn title="Slipped" count={leftover} empty="Nothing slipped. Nice.">
                  {review.openGoals.map((goal) => (
                    <GoalLine key={goal.id} goal={goal} />
                  ))}
                  {review.slipped.map((task) => (
                    <TaskLine key={task.id} task={task} />
                  ))}
                </ReviewColumn>
                <ReviewColumn title="Next week" count={review.nextGoals.length + review.nextTasks.length} empty="Nothing planned for next week yet.">
                  {review.nextGoals.map((goal) => (
                    <GoalLine key={goal.id} goal={goal} />
                  ))}
                  {review.nextTasks.map((task) => (
                    <TaskLine key={task.id} task={task} />
                  ))}
                </ReviewColumn>
              </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
