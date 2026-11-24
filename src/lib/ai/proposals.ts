// Changes the AI assistant proposes (#310). Its write tools never change anything: each one adds
// steps to the answer's proposal, which the chat shows as one card with a checkbox per change. Only
// the person applies it, the changes they ticked, in one transaction (./proposals-server.ts), or
// cancels it; the model can do neither. Plain types and functions, so the tools, the server, the
// browser and the tests share them.
import { ticketOverview, type TicketOverview } from "@/lib/ai/ticket-sections";
import { descriptionPreview } from "@/lib/description-sections";
import { priorityLabels, type Priority } from "@/lib/priority";

/** How long a proposal can be applied after the answer that made it. */
export const PROPOSAL_TTL_MS = 60 * 60 * 1000;
/** Changes one answer can propose: a project with its tasks fits, and the card stays easy to check. */
export const MAX_PROPOSAL_STEPS = 20;

export const PROPOSAL_NOT_FOUND = "These changes aren't there any more.";

export type TaskStatus = "TODO" | "IN_PROGRESS" | "DONE";

/** An item that exists: its id, and its name or title when the change was proposed. */
export type ExistingItem = { id: string; name: string };

/** A task that exists, with where it was and when it was due when the change was proposed, for the card. */
export type ExistingTask = ExistingItem & {
  /** Its project's name; null for a personal task. */
  project: string | null;
  /** YYYY-MM-DD, or null for none. */
  dueDate: string | null;
};

/** A project or task a step points at: one that exists, or one an earlier step creates ("new-1"). */
export type ItemRef = ExistingItem | { ref: string; name: string };

/** A field of an existing task that changes: its value when proposed, and the new one. */
export type TaskChange =
  | { field: "title"; from: string; to: string }
  | { field: "description"; from: string | null; to: string | null }
  /** Due dates as YYYY-MM-DD; null for none. */
  | { field: "dueDate"; from: string | null; to: string | null }
  | { field: "priority"; from: Priority; to: Priority }
  | { field: "status"; from: TaskStatus; to: TaskStatus }
  | { field: "project"; from: ExistingItem | null; to: ItemRef | null };

export type ProposalStep =
  | { kind: "create_project"; ref: string; name: string; description: string | null }
  | {
      kind: "create_task";
      ref: string;
      title: string;
      description: string | null;
      /** YYYY-MM-DD, or null for none. */
      dueDate: string | null;
      priority: Priority;
      project: ItemRef | null;
      /** The task it's a subtask of; a subtask goes in its parent's project. */
      parent: ItemRef | null;
      /**
       * Offered for the person to choose, so it starts unticked: a subtask the AI suggests to split
       * a ticket's work over 2 days (#434). Absent on everything else.
       */
      suggested?: boolean;
    }
  | { kind: "update_task"; task: ExistingTask; changes: TaskChange[] }
  | { kind: "complete_task"; task: ExistingTask }
  | {
      kind: "create_event";
      ref: string;
      title: string;
      /** YYYY-MM-DD. */
      date: string;
      /** HH:MM, 24-hour; null for an all-day event. */
      startTime: string | null;
      endTime: string | null;
      description: string | null;
      project: ItemRef | null;
    }
  | { kind: "trash_task"; task: ExistingTask };

export type ProposalStepKind = ProposalStep["kind"];

/** The steps one answer proposes so far, and the number for the next new item's ref. */
export type ProposalDraft = { steps: ProposalStep[]; nextRef: number };

export function newDraft(): ProposalDraft {
  return { steps: [], nextRef: 1 };
}

/** A ref for an item the proposal creates: "new-1", "new-2"… Tools take it in place of an id. */
export function takeRef(draft: ProposalDraft) {
  const ref = `new-${draft.nextRef}`;
  draft.nextRef += 1;
  return ref;
}

export function isExisting(item: ItemRef): item is ExistingItem {
  return "id" in item;
}

/** The project's name, or the task's or event's title, as the person saw it. */
export function stepTitle(step: ProposalStep) {
  switch (step.kind) {
    case "create_project":
      return step.name;
    case "create_task":
    case "create_event":
      return step.title;
    default:
      return step.task.name;
  }
}

/** Where a proposal stands for the person: `expired` is a pending one past its hour. */
export type ProposalState = "pending" | "applied" | "cancelled" | "failed" | "expired";

export type StoredProposalStatus = "PENDING" | "APPLIED" | "CANCELLED" | "FAILED";

/** Why a proposal that isn't pending can't be applied or cancelled. */
export const NOT_PENDING_MESSAGES: Record<Exclude<ProposalState, "pending">, string> = {
  applied: "These changes were already applied.",
  cancelled: "These changes were cancelled, so nothing was changed.",
  failed: "These changes couldn't be applied, so nothing was changed.",
  expired: "These changes expired after an hour, so nothing was changed. Ask again for new ones.",
};

/** Where to see a change once it's applied: the step it came from, by index, and its page in the app. */
export type ProposalLink = { step: number; title: string; href: string };

/** A proposal as the chat shows it. */
export type ProposalView = {
  id: string;
  state: ProposalState;
  /** ISO time after which a pending proposal can't be applied. */
  expiresAt: string;
  steps: ProposalStep[];
  /** The steps applied, by index; the person left out the others. Empty unless applied. */
  applied: number[];
  /** Links to what applying changed, one per applied step. */
  links: ProposalLink[];
  /** Why applying it was refused; nothing changed. */
  error: string | null;
};

export function proposalState(status: StoredProposalStatus, expiresAt: Date, now = new Date()): ProposalState {
  if (status === "PENDING") return expiresAt.getTime() <= now.getTime() ? "expired" : "pending";
  return status === "APPLIED" ? "applied" : status === "CANCELLED" ? "cancelled" : "failed";
}

/** The refs of the new items a step points at: its parent task first, then its project. */
function refsOf(step: ProposalStep): string[] {
  const items =
    step.kind === "create_task"
      ? [step.parent, step.project]
      : step.kind === "create_event"
        ? [step.project]
        : step.kind === "update_task"
          ? step.changes.flatMap((change) => (change.field === "project" ? [change.to] : []))
          : [];
  return items.flatMap((item) => (item && !isExisting(item) ? [item.ref] : []));
}

/**
 * The steps each step needs, by index: the earlier steps that create the new project or parent
 * task it goes in. The first is the one the card shows it under: its parent task, else its project.
 */
export function stepNeeds(steps: ProposalStep[]): number[][] {
  const made = new Map<string, number>();
  return steps.map((step, index) => {
    const needs = [
      ...new Set(
        refsOf(step).flatMap((ref) => {
          const maker = made.get(ref);
          return maker === undefined ? [] : [maker];
        }),
      ),
    ];
    if ("ref" in step) made.set(step.ref, index);
    return needs;
  });
}

/** A step on the card's checklist, given the steps the person left out. */
export type StepChoice = {
  /** Ticked: applying applies it. */
  chosen: boolean;
  /** The left-out step it needs, which keeps it out until that one is ticked again; null for none. */
  blockedBy: number | null;
};

/** Each step's place on the checklist: a step that needs a left-out step is left out too, and can't be ticked. */
export function stepChoices(steps: ProposalStep[], leftOut: ReadonlySet<number>): StepChoice[] {
  const needs = stepNeeds(steps);
  const blockers: Array<number | null> = [];
  for (const stepNeeds of needs) {
    // A step's needs come before it, so their blockers are already known.
    let blocker: number | null = null;
    for (const need of stepNeeds) {
      blocker = leftOut.has(need) ? need : blockers[need];
      if (blocker !== null) break;
    }
    blockers.push(blocker);
  }
  return blockers.map((blockedBy, index) => ({ chosen: blockedBy === null && !leftOut.has(index), blockedBy }));
}

/** Whether a step is only offered, for the person to tick (#434). */
function isSuggested(step: ProposalStep) {
  return step.kind === "create_task" && step.suggested === true;
}

/** The steps left out before the person ticks anything: the ones only offered, such as the subtasks that split a ticket (#434). */
export function initiallyLeftOut(steps: ProposalStep[]): Set<number> {
  return new Set(steps.flatMap((step, index) => (isSuggested(step) ? [index] : [])));
}

/**
 * The steps left out once the person ticks or unticks one. Ticking one again brings back the steps
 * that need it, except the ones only offered, which stay unticked until the person ticks them.
 */
export function toggleStep(steps: ProposalStep[], leftOut: ReadonlySet<number>, index: number): Set<number> {
  const next = new Set(leftOut);
  if (!next.has(index)) return next.add(index);
  const back = new Set([index]);
  stepNeeds(steps).forEach((needs, step) => {
    if (step === index || isSuggested(steps[step]) || !needs.some((need) => back.has(need))) return;
    back.add(step);
    next.delete(step);
  });
  next.delete(index);
  return next;
}

/** The ticked steps, by index, in order. */
export function chosenSteps(steps: ProposalStep[], leftOut: ReadonlySet<number>) {
  return stepChoices(steps, leftOut).flatMap((choice, index) => (choice.chosen ? [index] : []));
}

/**
 * Why the person can't apply just the steps `chosen` (by index), or null when they can: each one
 * once, from this proposal, with every step it needs. The card never asks for more than that.
 */
export function choiceProblem(steps: ProposalStep[], chosen: number[]): string | null {
  if (!chosen.length) return "Choose at least one change to apply.";
  if (new Set(chosen).size !== chosen.length || chosen.some((index) => !Number.isInteger(index) || index < 0 || index >= steps.length)) {
    return "Those aren't the changes this proposal has.";
  }
  const picked = new Set(chosen);
  const needs = stepNeeds(steps);
  for (const index of chosen) {
    const missing = needs[index].find((need) => !picked.has(need));
    if (missing !== undefined) return `“${stepTitle(steps[index])}” can't be applied without “${stepTitle(steps[missing])}”.`;
  }
  return null;
}

/** "Needs the Whitewall project": why a step is left out while the step it needs is. */
export function needsNote(needed: ProposalStep) {
  return needed.kind === "create_project" ? `Needs the ${needed.name} project` : `Needs the ${stepTitle(needed)} task`;
}

const DAY = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const DAY_WITH_YEAR = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const LONG_DAY = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
const LONG_DAY_WITH_YEAR = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

/** A day key (YYYY-MM-DD) as a date at midnight UTC: a date with no time, the same in every time zone. */
function utcDay(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

const yearOf = (key: string) => Number(key.slice(0, 4));

/** "Thu, Dec 17" for 2026-12-17, with the year when it isn't `thisYear`. */
export function formatDayKey(key: string, thisYear?: number) {
  return (thisYear !== undefined && yearOf(key) !== thisYear ? DAY_WITH_YEAR : DAY).format(utcDay(key));
}

/** "3:00 PM" for 15:00. */
export function formatClock(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${hours < 12 ? "AM" : "PM"}`;
}

/** "today", "tomorrow", "yesterday", or "Thu, Dec 17", seen from `today` (YYYY-MM-DD). */
function relativeDay(key: string, today: string) {
  const days = Math.round((utcDay(key).getTime() - utcDay(today).getTime()) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return formatDayKey(key, yearOf(today));
}

const STATUS_LABELS: Record<TaskStatus, string> = { TODO: "To do", IN_PROGRESS: "In progress", DONE: "Done" };

/** What the card calls a task with no project, as the rest of the app does. */
const PERSONAL = "Personal";
/** A project description longer than this goes behind its row's details button. */
const SHORT_DESCRIPTION = 140;
/** Longer values in a change are cut short. */
const CHANGE_TEXT = 80;

export type ProposalRowKind = "project" | "task" | "event" | "done" | "update" | "trash";

/** One change as the card lists it. */
export type ProposalRow = {
  /** The step's index in the proposal. */
  index: number;
  kind: ProposalRowKind;
  /** What happens to the item: "New project", "Mark as done", "Move to the Trash"… */
  verb: string;
  title: string;
  /** Short facts on one line: "Whitewall · Due Thu, Dec 17 · High". Empty when there are none. */
  details: string;
  /** A longer description, shown on request; null for none. */
  description: string | null;
  /** A new task written as a ticket (#433): its summary and counts. The card opens it as a draft. */
  ticket: TicketOverview | null;
  /** For a change: each field, before and after. */
  changes: Array<{ label: string; from: string; to: string }>;
  /** How far it's indented under the new project or task it goes in: 0, 1 or 2. */
  depth: number;
};

const facts = (...parts: Array<string | null>) => parts.filter(Boolean).join(" · ");

function shortened(text: string) {
  return text.length > CHANGE_TEXT ? `${text.slice(0, CHANGE_TEXT - 1)}…` : text;
}

function changeRow(change: TaskChange, thisYear: number): ProposalRow["changes"][number] {
  const none = "None";
  switch (change.field) {
    case "title":
      return { label: "Title", from: shortened(change.from), to: shortened(change.to) };
    case "description":
      // A ticket's summary, rather than its Markdown (#433).
      return {
        label: "Description",
        from: change.from ? shortened(descriptionPreview(change.from) || change.from) : none,
        to: change.to ? shortened(descriptionPreview(change.to) || change.to) : none,
      };
    case "dueDate":
      return {
        label: "Due",
        from: change.from ? formatDayKey(change.from, thisYear) : none,
        to: change.to ? formatDayKey(change.to, thisYear) : none,
      };
    case "priority":
      return { label: "Priority", from: priorityLabels[change.from], to: priorityLabels[change.to] };
    case "status":
      return { label: "Status", from: STATUS_LABELS[change.from], to: STATUS_LABELS[change.to] };
    case "project":
      return { label: "Project", from: change.from?.name ?? PERSONAL, to: change.to?.name ?? PERSONAL };
  }
}

function eventFacts(step: Extract<ProposalStep, { kind: "create_event" }>, today: string) {
  const day = (yearOf(step.date) === yearOf(today) ? LONG_DAY : LONG_DAY_WITH_YEAR).format(utcDay(step.date));
  const time = !step.startTime ? "All day" : step.endTime ? `${formatClock(step.startTime)} to ${formatClock(step.endTime)}` : formatClock(step.startTime);
  return facts(day, time, step.project?.name ?? null);
}

/** An existing task's place: "Whitewall · Due today", "Personal". */
function taskPlace(task: ExistingTask, today: string) {
  return facts(task.project ?? PERSONAL, task.dueDate ? `Due ${relativeDay(task.dueDate, today)}` : null);
}

function row(step: ProposalStep, index: number, depth: number, today: string): ProposalRow {
  const base = { index, depth, details: "", description: null, ticket: null, changes: [] };
  switch (step.kind) {
    case "create_project": {
      const long = (step.description?.length ?? 0) > SHORT_DESCRIPTION;
      return { ...base, kind: "project", verb: "New project", title: step.name, details: long ? "" : (step.description ?? ""), description: long ? step.description : null };
    }
    case "create_task":
      return {
        ...base,
        kind: "task",
        verb: step.suggested ? "Suggested subtask" : step.parent ? "New subtask" : "New task",
        title: step.title,
        details: facts(
          step.project?.name ?? PERSONAL,
          step.parent ? `Under ${step.parent.name}` : null,
          step.dueDate ? `Due ${relativeDay(step.dueDate, today)}` : null,
          step.priority !== "NONE" ? priorityLabels[step.priority] : null,
        ),
        description: step.description,
        ticket: ticketOverview(step.description),
      };
    case "create_event":
      return { ...base, kind: "event", verb: "New event", title: step.title, details: eventFacts(step, today), description: step.description };
    case "update_task":
      return { ...base, kind: "update", verb: "Change", title: step.task.name, changes: step.changes.map((change) => changeRow(change, yearOf(today))) };
    case "complete_task":
      return { ...base, kind: "done", verb: "Mark as done", title: step.task.name, details: taskPlace(step.task, today) };
    case "trash_task":
      return { ...base, kind: "trash", verb: "Move to the Trash", title: step.task.name, details: taskPlace(step.task, today) };
  }
}

/**
 * The card's rows: each new project or task followed by what goes in it, indented, and otherwise
 * in the order the changes were proposed. `today` (YYYY-MM-DD, the person's own) reads due dates
 * as "today" or "tomorrow", and leaves out this year's year.
 */
export function proposalRows(steps: ProposalStep[], today: string): ProposalRow[] {
  const needs = stepNeeds(steps);
  const under = needs.map(() => [] as number[]);
  const tops: number[] = [];
  needs.forEach((stepNeeds, index) => (stepNeeds.length ? under[stepNeeds[0]].push(index) : tops.push(index)));
  const rows: ProposalRow[] = [];
  const visit = (index: number, depth: number) => {
    rows.push(row(steps[index], index, Math.min(depth, 2), today));
    for (const child of under[index]) visit(child, depth + 1);
  };
  for (const index of tops) visit(index, 0);
  return rows;
}

/** "4 changes" or "1 change". */
export function changeCount(count: number) {
  return `${count} ${count === 1 ? "change" : "changes"}`;
}
