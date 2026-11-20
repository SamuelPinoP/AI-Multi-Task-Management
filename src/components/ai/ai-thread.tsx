"use client";

import { CalendarDays, FolderKanban, Info, NotebookPen, RotateCcw, SquareCheckBig, Target, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { Fragment, useMemo } from "react";
import { AiProposalCard } from "@/components/ai/ai-proposal-card";
import { uiButtonClass } from "@/components/ui";
import { answerBlocks, finishedStep, type ChatTurn, type TextRun } from "@/lib/ai/chat-client";
import type { Source } from "@/lib/ai/tools/define";
import { cn } from "@/lib/cn";

const SOURCE_ICONS: Record<Source["kind"], LucideIcon> = {
  task: SquareCheckBig,
  event: CalendarDays,
  project: FolderKanban,
  note: NotebookPen,
  goal: Target,
};

function Runs({ runs }: { runs: TextRun[] }) {
  return runs.map((run, index) =>
    run.strong ? (
      <strong key={index} className="font-semibold">
        {run.text}
      </strong>
    ) : (
      <Fragment key={index}>{run.text}</Fragment>
    ),
  );
}

/** The answer's words: paragraphs and lists, with bold where the model asked for it, never HTML. */
function AnswerText({ text }: { text: string }) {
  const blocks = useMemo(() => answerBlocks(text), [text]);
  return (
    <div className="grid gap-2 break-words">
      {blocks.map((block, index) => {
        if (block.kind === "paragraph") {
          return (
            <p key={index}>
              {block.lines.map((line, lineIndex) => (
                <Fragment key={lineIndex}>
                  {lineIndex ? <br /> : null}
                  <Runs runs={line} />
                </Fragment>
              ))}
            </p>
          );
        }
        const List = block.ordered ? "ol" : "ul";
        return (
          <List key={index} className={cn("grid gap-1 pl-5", block.ordered ? "list-decimal" : "list-disc marker:text-muted")}>
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex}>
                <Runs runs={item} />
              </li>
            ))}
          </List>
        );
      })}
    </div>
  );
}

/** What the assistant looked at: "Checked your open tasks", or "Checking your calendar…" while it runs. */
function Step({ label, working = false }: { label: string; working?: boolean }) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted">
      <span aria-hidden="true" className={cn("h-1.5 w-1.5 shrink-0 rounded-full bg-accent", working && "animate-pulse motion-reduce:animate-none")} />
      {label}
    </span>
  );
}

function SourceLink({ source, onNavigate }: { source: Source; onNavigate?: () => void }) {
  const Icon = SOURCE_ICONS[source.kind] ?? SquareCheckBig;
  return (
    <Link
      href={source.href}
      onClick={onNavigate}
      className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-lg border border-line bg-sunken px-2 py-1 text-xs text-ink transition-colors hover:bg-surface-hover"
    >
      <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-muted" />
      <span className="truncate">{source.title}</span>
    </Link>
  );
}

function Answer({ turn, canRetry, onRetry, onNavigate }: { turn: ChatTurn; canRetry: boolean; onRetry: (turnId: string) => void; onNavigate?: () => void }) {
  const { answer } = turn;
  const waiting = !answer.done && !answer.text;
  const finished = waiting ? answer.steps.slice(0, -1) : answer.steps;

  return (
    <div className="flex min-w-0 flex-col gap-2 text-sm leading-relaxed text-ink">
      <span className="sr-only">AI Multi:</span>
      {finished.length ? (
        <div className="grid gap-1">
          {finished.map((step) => (
            <Step key={step} label={finishedStep(step)} />
          ))}
        </div>
      ) : null}
      {waiting && !answer.error ? <Step working label={`${answer.steps.at(-1) ?? "Thinking"}…`} /> : null}

      {answer.notice ? (
        <p className="flex gap-2 rounded-lg border border-line bg-sunken px-3 py-2 text-xs leading-normal text-muted">
          <Info aria-hidden="true" className="mt-px h-3.5 w-3.5 shrink-0" />
          {answer.notice}
        </p>
      ) : null}

      {answer.text ? <AnswerText text={answer.text} /> : null}

      {answer.proposal ? <AiProposalCard proposal={answer.proposal} onNavigate={onNavigate} /> : null}

      {answer.sources.length ? (
        <ul aria-label="Used to answer" className="flex flex-wrap gap-1.5">
          {answer.sources.map((source) => (
            <li key={`${source.kind}:${source.id}`} className="min-w-0 max-w-full">
              <SourceLink source={source} onNavigate={onNavigate} />
            </li>
          ))}
        </ul>
      ) : null}

      {answer.error ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm text-danger">{answer.error}</p>
          {canRetry ? (
            <button type="button" onClick={() => onRetry(turn.id)} className={cn(uiButtonClass, "gap-1.5 px-2.5 py-1 text-xs")}>
              <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />
              Try again
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * A conversation with the assistant (#308): each question on the right, and under it what the
 * assistant looked at, its answer, the changes it proposes to apply or cancel (#310), and links to
 * the items it used. Shared by the AI page and the AI
 * bar's chat. Only the last answer offers "Try again" when it failed.
 */
export function AiThread({
  turns,
  busy,
  onRetry,
  onNavigate,
  className,
}: {
  turns: ChatTurn[];
  busy: boolean;
  onRetry: (turnId: string) => void;
  /** Following one of the answer's links (the AI bar's chat closes on phones). */
  onNavigate?: () => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-5", className)}>
      {turns.map((turn, index) => (
        <Fragment key={turn.id}>
          <p className="max-w-[80%] self-end whitespace-pre-wrap break-words rounded-[1.125rem] bg-sunken px-3.5 py-2 text-sm leading-relaxed text-ink">
            <span className="sr-only">You: </span>
            {turn.question}
          </p>
          <Answer turn={turn} canRetry={!busy && index === turns.length - 1} onRetry={onRetry} onNavigate={onNavigate} />
        </Fragment>
      ))}
    </div>
  );
}

/** While a chat from the list loads its messages (#452). */
export function AiThreadLoading({ className }: { className?: string }) {
  return (
    <p role="status" className={cn("m-auto flex items-center gap-1.5 py-6 text-xs text-muted", className)}>
      <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-accent motion-reduce:animate-none" />
      Loading the chat…
    </p>
  );
}
