"use client";

import { CalendarDays, ChevronRight, CircleAlert, CircleCheck, FolderKanban, Info, Pencil, SquareCheckBig, Trash2, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useAiChat } from "@/components/ai/ai-chat-provider";
import { uiButtonClass, uiPrimaryButtonClass } from "@/components/ui";
import { OFFLINE_MESSAGE } from "@/lib/ai/chat-client";
import { NOT_PENDING_MESSAGES, needsNote, proposalRows, stepChoices, toggleStep, type ProposalRow, type ProposalRowKind, type ProposalView } from "@/lib/ai/proposals";
import { cn } from "@/lib/cn";
import { formatTaskDayKey } from "@/lib/task-date-buckets";
import { notifyWorkspaceChanged, TASK_CREATED_EVENT } from "@/lib/workspace-events";

const ICONS: Record<ProposalRowKind, LucideIcon> = {
  project: FolderKanban,
  task: SquareCheckBig,
  event: CalendarDays,
  done: CircleCheck,
  update: Pencil,
  trash: Trash2,
};

/** Each kind of change's colors: new items plain, done green, changes amber, the Trash red. */
const TONES: Record<ProposalRowKind, { tile: string; verb: string }> = {
  project: { tile: "bg-sunken text-muted", verb: "text-muted" },
  task: { tile: "bg-sunken text-muted", verb: "text-muted" },
  event: { tile: "bg-sunken text-muted", verb: "text-muted" },
  done: { tile: "bg-success-soft text-success", verb: "text-success" },
  update: { tile: "bg-warning-soft text-warning", verb: "text-warning" },
  trash: { tile: "bg-danger-soft text-danger", verb: "text-danger" },
};

/** Rows indent under the new project or task they go in, so the checkbox sits under its icon. */
const INDENTS = ["pl-3", "pl-[3.125rem]", "pl-[5.5rem]"];

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

function appliedTitle(applied: number, total: number) {
  return applied < total ? `Applied ${applied} of ${plural(total, "change")}` : `Applied ${plural(total, "change")}`;
}

/** What screen readers hear once the proposal is decided. */
function outcome(proposal: ProposalView) {
  switch (proposal.state) {
    case "applied":
      return `${appliedTitle(proposal.applied.length, proposal.steps.length)}.`;
    case "cancelled":
      return "Cancelled. Nothing was changed.";
    case "pending":
      return "";
    default:
      return proposal.error ?? NOT_PENDING_MESSAGES[proposal.state];
  }
}

function Note({ icon: Icon, children, tone = "plain" }: { icon: LucideIcon; children: string; tone?: "plain" | "danger" }) {
  return (
    <p
      className={cn(
        "flex gap-2 rounded-lg border px-3 py-2 text-xs leading-normal",
        tone === "danger" ? "border-danger/30 bg-danger-soft text-danger" : "border-line bg-sunken text-muted",
      )}
    >
      <Icon aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      {children}
    </p>
  );
}

function ChangeRow({
  row,
  checked,
  blockedNote,
  disabled,
  open,
  onToggle,
  onOpen,
}: {
  row: ProposalRow;
  checked: boolean;
  /** Why it's left out and can't be ticked: "Needs the Whitewall project". */
  blockedNote: string | null;
  disabled: boolean;
  open: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const Icon = ICONS[row.kind];
  const tone = TONES[row.kind];
  const descriptionId = useId();
  // The spaces between the label's parts are for screen readers; flex layout doesn't show them.
  return (
    <li className={cn("flex flex-col py-[0.4375rem] pr-2", INDENTS[row.depth], blockedNote && "opacity-55")}>
      <div className="flex items-start gap-1.5">
        <label className={cn("flex min-w-0 flex-1 items-start gap-2.5", !disabled && !blockedNote && "cursor-pointer")}>
          <input type="checkbox" checked={checked} disabled={disabled || blockedNote !== null} onChange={onToggle} className="mt-1.5 h-4 w-4 shrink-0 accent-accent" />
          <span aria-hidden="true" className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-lg", tone.tile)}>
            <Icon className="h-4 w-4" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-px">
            <span className="flex flex-wrap items-baseline gap-x-1.5">
              <span className={cn("text-xs font-medium leading-[1.125rem]", tone.verb)}>{row.verb}</span>{" "}
              <span className="text-sm font-medium leading-5 text-ink [overflow-wrap:anywhere]">{row.title}</span>
            </span>{" "}
            {row.details ? <span className="text-xs leading-[1.125rem] text-muted">{row.details}</span> : null}{" "}
            {row.changes.map((change) => (
              <span key={change.label} className="text-xs leading-[1.125rem] text-muted [overflow-wrap:anywhere]">
                {change.label} <s>{change.from}</s> → <span className="font-medium text-ink">{change.to}</span>{" "}
              </span>
            ))}
            {blockedNote ? <span className="text-xs leading-[1.125rem] text-warning">{blockedNote}</span> : null}
          </span>
        </label>
        {row.description ? (
          <button
            type="button"
            aria-label={`${open ? "Hide" : "Show"} details of ${row.title}`}
            aria-expanded={open}
            aria-controls={open ? descriptionId : undefined}
            onClick={onOpen}
            className="-my-1.5 -mr-1 grid h-10 w-10 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-hover hover:text-ink sm:m-0 sm:h-7 sm:w-7"
          >
            <ChevronRight aria-hidden="true" className={cn("h-4 w-4 transition-transform motion-reduce:transition-none", open && "rotate-90")} />
          </button>
        ) : null}
      </div>
      {row.description && open ? (
        // Under the title: past the checkbox, its gap, the icon and its gap.
        <p id={descriptionId} className="mt-1 whitespace-pre-wrap pl-16 text-[0.78125rem] leading-[1.1875rem] text-ink [overflow-wrap:anywhere]">
          {row.description}
        </p>
      ) : null}
    </li>
  );
}

/**
 * The changes an answer proposed (#310), with a checkbox each: the person ticks what to apply, as
 * in Todoist's Ramble, then applies it or cancels it. A change that goes in a new project or task
 * is left out with it. Applying runs on the server, all of the ticked changes or none; afterwards
 * the card links to what changed. Nothing changes before Apply.
 */
export function AiProposalCard({ proposal, onNavigate }: { proposal: ProposalView; onNavigate?: () => void }) {
  const { replaceProposal } = useAiChat();
  const router = useRouter();
  const [leftOut, setLeftOut] = useState<Set<number>>(() => new Set());
  const [open, setOpen] = useState<Set<number>>(() => new Set());
  const [busy, setBusy] = useState<"apply" | "cancel" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const result = useRef<HTMLDivElement>(null);
  const decidedHere = useRef(false);

  // The person's own today, for "Due today"; the card only renders in the browser.
  const today = formatTaskDayKey(new Date());
  const rows = useMemo(() => proposalRows(proposal.steps, today), [proposal.steps, today]);
  const choices = useMemo(() => stepChoices(proposal.steps, leftOut), [proposal.steps, leftOut]);
  const chosen = choices.flatMap((choice, index) => (choice.chosen ? [index] : []));
  const total = proposal.steps.length;

  // Once Apply or Cancel here has an answer, the buttons are gone: keyboard focus goes to what happened.
  useEffect(() => {
    if (proposal.state === "pending" || !decidedHere.current) return;
    decidedHere.current = false;
    result.current?.focus();
  }, [proposal.state]);

  async function decide(action: "apply" | "cancel") {
    setBusy(action);
    setError(null);
    try {
      const response = await fetch(`/api/agent/proposals/${encodeURIComponent(proposal.id)}/${action}`, {
        method: "POST",
        ...(action === "apply" ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ steps: chosen }) } : {}),
      });
      const body = (await response.json().catch(() => null)) as { proposal?: ProposalView | null; error?: string } | null;
      const next = body?.proposal;
      if (next && next.state !== "pending") {
        decidedHere.current = true;
        replaceProposal(next, outcome(next));
        if (next.state === "applied" && response.ok) {
          // The sidebar's counts, the Tasks page, and pages the server renders show the changes.
          notifyWorkspaceChanged();
          window.dispatchEvent(new Event(TASK_CREATED_EVENT));
          router.refresh();
        }
        return;
      }
      setError(body?.error ?? "Something went wrong. Try again in a moment.");
    } catch {
      setError(OFFLINE_MESSAGE);
    } finally {
      setBusy(null);
    }
  }

  if (proposal.state === "cancelled") {
    return (
      <div ref={result} tabIndex={-1} className="outline-none">
        <Note icon={Info}>Cancelled. Nothing was changed.</Note>
      </div>
    );
  }
  if (proposal.state === "expired" || proposal.state === "failed") {
    return (
      <div ref={result} tabIndex={-1} className="outline-none">
        <Note icon={CircleAlert} tone={proposal.state === "failed" ? "danger" : "plain"}>
          {proposal.error ?? NOT_PENDING_MESSAGES[proposal.state]}
        </Note>
      </div>
    );
  }

  if (proposal.state === "applied") {
    const applied = new Set(proposal.applied);
    const links = new Map(proposal.links.map((link) => [link.step, link]));
    const leftOutTitles = rows.filter((row) => !applied.has(row.index)).map((row) => row.title);
    return (
      <section ref={result} tabIndex={-1} aria-label="Applied changes" className="flex flex-col gap-2 rounded-xl border border-line bg-surface px-3 py-2.5 outline-none">
        <p className="flex items-center gap-1.5 text-[0.8125rem] font-semibold leading-[1.125rem] text-success">
          <CircleCheck aria-hidden="true" className="h-4 w-4 shrink-0" />
          {appliedTitle(applied.size, total)}
        </p>
        <ul className="flex flex-wrap gap-1.5">
          {rows
            .filter((row) => applied.has(row.index))
            .map((row) => {
              const link = links.get(row.index);
              const Icon = row.kind === "done" || row.kind === "update" ? SquareCheckBig : ICONS[row.kind];
              const title = `${link?.title ?? row.title}${row.kind === "trash" ? " · in the Trash" : ""}`;
              const chip = "inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-lg border border-line bg-sunken px-2 py-1 text-xs text-ink";
              const content = (
                <>
                  <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-muted" />
                  <span className="truncate">{title}</span>
                </>
              );
              return (
                <li key={row.index} className="min-w-0 max-w-full">
                  {link ? (
                    <Link href={link.href} onClick={onNavigate} className={cn(chip, "transition-colors hover:bg-surface-hover")}>
                      {content}
                    </Link>
                  ) : (
                    <span className={chip}>{content}</span>
                  )}
                </li>
              );
            })}
        </ul>
        {leftOutTitles.length ? <p className="text-xs leading-[1.125rem] text-muted">Left out: {leftOutTitles.join(", ")}</p> : null}
      </section>
    );
  }

  const deciding = busy !== null;
  const applyLabel = busy === "apply" ? "Applying…" : chosen.length === total ? `Apply all ${total}` : `Apply ${chosen.length} of ${total}`;
  return (
    <section aria-label="Changes to apply" aria-busy={deciding} className="overflow-hidden rounded-xl border border-line bg-surface">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
        <p className="text-[0.8125rem] font-semibold text-ink">Choose what to apply</p>
        <span className="ml-auto text-xs text-muted">
          {chosen.length} of {total} selected
        </span>
      </div>
      <ul className="py-1">
        {rows.map((row) => {
          const choice = choices[row.index];
          return (
            <ChangeRow
              key={row.index}
              row={row}
              checked={choice.chosen}
              blockedNote={choice.blockedBy === null ? null : needsNote(proposal.steps[choice.blockedBy])}
              disabled={deciding}
              open={open.has(row.index)}
              onToggle={() => setLeftOut((current) => toggleStep(proposal.steps, current, row.index))}
              onOpen={() =>
                setOpen((current) => {
                  const next = new Set(current);
                  if (!next.delete(row.index)) next.add(row.index);
                  return next;
                })
              }
            />
          );
        })}
      </ul>
      {error ? (
        <p role="alert" className="px-3 pb-1 text-xs text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex items-center gap-2 border-t border-line px-3 py-2.5">
        <button
          type="button"
          onClick={() => void decide("apply")}
          disabled={deciding || !chosen.length}
          // The same border width as Cancel's, so on a phone the two are exactly as wide.
          className={cn(uiPrimaryButtonClass, "h-11 flex-1 whitespace-nowrap border border-transparent py-0 sm:h-9 sm:flex-none")}
        >
          {applyLabel}
        </button>
        <button type="button" onClick={() => void decide("cancel")} disabled={deciding} className={cn(uiButtonClass, "h-11 flex-1 whitespace-nowrap py-0 sm:h-9 sm:flex-none")}>
          {busy === "cancel" ? "Cancelling…" : "Cancel"}
        </button>
      </div>
    </section>
  );
}
