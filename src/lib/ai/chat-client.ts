// The AI chat in the browser (#308): reads the answer's stream of JSON lines
// (`ChatEvent`, from POST /api/agent/chat), folds each event into the answer
// the chat shows (the server folds them the same way to store the answer,
// #452), turns a stored chat back into a conversation, groups the chats by day,
// and splits an answer's text into paragraphs and lists. Plain functions,
// without React or server code, so they're unit tested on their own; the chat's
// state lives in src/components/ai/ai-chat-provider.tsx.
import type { Allowance } from "@/lib/ai/allowance";
import type { AgentStatus, ChatEvent } from "@/lib/ai/chat";
import type { StoredMessage } from "@/lib/ai/chat-history-core";
import type { Source } from "@/lib/ai/tools/define";
import { dayKeyInZone } from "@/lib/user-time";

/** One answer as the chat shows it, filled in as its events arrive. */
export type ChatAnswer = {
  /** What it looked at, in order, as the tools name it while they run: "Checking your open tasks". */
  steps: string[];
  /** The items it used, as links. */
  sources: Source[];
  text: string;
  /** Why the planner answers instead of a model: a cap, an outage, the person's country. */
  notice: string | null;
  /** What went wrong, when something did. */
  error: string | null;
  /** The last event has arrived, or the stream ended. */
  done: boolean;
};

export type ChatTurn = {
  id: string;
  question: string;
  answer: ChatAnswer;
};

/** Shown when the stream ends without saying how it went. */
export const INTERRUPTED_MESSAGE = "The answer stopped partway. Try again.";
/** Shown when AI Multi can't be reached at all. */
export const OFFLINE_MESSAGE = "Couldn't reach AI Multi. Check your connection and try again.";

export function emptyAnswer(): ChatAnswer {
  return { steps: [], sources: [], text: "", notice: null, error: null, done: false };
}

function addSources(current: Source[], added: Source[]) {
  const seen = new Set(current.map((source) => `${source.kind}:${source.id}`));
  const fresh = added.filter((source) => {
    const key = `${source.kind}:${source.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return fresh.length ? [...current, ...fresh] : current;
}

/** The answer after one more event from the stream. */
export function applyChatEvent(answer: ChatAnswer, event: ChatEvent): ChatAnswer {
  switch (event.type) {
    case "start":
      return event.mode === "planner" ? { ...answer, notice: event.message } : answer;
    case "tool":
      return answer.steps.includes(event.label) ? answer : { ...answer, steps: [...answer.steps, event.label] };
    case "sources":
      return { ...answer, sources: addSources(answer.sources, event.items) };
    case "text":
      return { ...answer, text: answer.text + event.text };
    case "notice":
      // The model stopped partway and the planner answers instead: its answer replaces any partial one.
      return { ...answer, notice: event.message, text: "", sources: [] };
    case "error":
      return { ...answer, error: event.message };
    case "done":
      return { ...answer, done: true };
    default:
      return answer;
  }
}

/** The allowance an event reports: `start` has today's, `done` the one after this message. */
export function allowanceIn(event: ChatEvent): Allowance | null {
  if (event.type === "start") return event.allowance;
  if (event.type === "done") return event.allowance;
  return null;
}

/** "38 of 40 left today": the person's own model requests (a question takes one, or two with a lookup). */
export function allowanceText(allowance: Allowance) {
  return `${allowance.user.remaining} of ${allowance.user.limit} left today`;
}

/**
 * The allowance as the chat shows it under its message box, or null: before the status arrives, and
 * when the planner answers whatever the allowance (no model here, or the person's country).
 */
export function allowanceLine(status: AgentStatus | null) {
  if (!status) return null;
  if (status.mode === "planner" && (status.reason === "region" || status.reason === "disabled")) return null;
  return allowanceText(status.allowance);
}

const PAST_TENSE: Record<string, string> = { Checking: "Checked", Counting: "Counted", Searching: "Searched", Looking: "Looked", Reading: "Read" };

/** A step once the answer is done: "Checking your open tasks" becomes "Checked your open tasks". */
export function finishedStep(label: string) {
  const [verb, ...rest] = label.split(" ");
  return PAST_TENSE[verb] ? [PAST_TENSE[verb], ...rest].join(" ") : label;
}

/**
 * Splits the answer's stream into events, one JSON object per line. A line that arrives in pieces
 * waits for the rest; `end` reads whatever is left when the stream closes. Lines that aren't JSON
 * are skipped: the stream comes from AI Multi's own endpoint.
 */
export function createEventReader() {
  let buffer = "";
  const parse = (line: string): ChatEvent[] => {
    const trimmed = line.trim();
    if (!trimmed) return [];
    try {
      const event = JSON.parse(trimmed) as ChatEvent;
      return event && typeof event === "object" && typeof event.type === "string" ? [event] : [];
    } catch {
      return [];
    }
  };
  return {
    push(chunk: string): ChatEvent[] {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      return lines.flatMap(parse);
    },
    end(): ChatEvent[] {
      const rest = buffer;
      buffer = "";
      return parse(rest);
    },
  };
}

/**
 * Shown with a stored answer the planner gave (#452). The reason it gave at the time (a cap that
 * has since reset, an outage) would be out of date, so the note only says who answered.
 */
export const PLANNER_NOTE = "Your planner answered this one instead of the AI.";

/**
 * A stored chat as the conversation shows it: each question with the answer stored after it. The
 * server stores both together, so a question without an answer only comes from damaged data, and is
 * left out.
 */
export function turnsFromMessages(messages: StoredMessage[]): ChatTurn[] {
  const turns: ChatTurn[] = [];
  let asked: StoredMessage | null = null;
  for (const message of messages) {
    if (message.role === "USER") {
      asked = message;
      continue;
    }
    if (!asked) continue;
    turns.push({
      id: asked.id,
      question: asked.content,
      answer: {
        steps: [],
        sources: message.sources,
        text: message.content,
        notice: message.role === "PLANNER" ? PLANNER_NOTE : null,
        error: null,
        done: true,
      },
    });
    asked = null;
  }
  return turns;
}

export type ChatGroupLabel = "Today" | "Yesterday" | "Previous 7 days" | "Previous 30 days" | "Older";

const GROUP_ORDER: ChatGroupLabel[] = ["Today", "Yesterday", "Previous 7 days", "Previous 30 days", "Older"];

function daysBetween(fromKey: string, toKey: string) {
  return Math.round((Date.parse(`${toKey}T00:00:00Z`) - Date.parse(`${fromKey}T00:00:00Z`)) / 86_400_000);
}

/**
 * The chats by day of their latest message in the person's time zone, as the round-2 canvas shows
 * them: Today, Yesterday, Previous 7 days, Previous 30 days, then Older. Empty groups are left out;
 * each keeps the chats' order.
 */
export function chatGroups<Chat extends { updatedAt: string }>(chats: Chat[], timeZone: string | null, now = new Date()) {
  const today = dayKeyInZone(timeZone, now);
  const groups = new Map<ChatGroupLabel, Chat[]>();
  for (const chat of chats) {
    const days = daysBetween(dayKeyInZone(timeZone, new Date(chat.updatedAt)), today);
    const label: ChatGroupLabel = days <= 0 ? "Today" : days === 1 ? "Yesterday" : days <= 7 ? "Previous 7 days" : days <= 30 ? "Previous 30 days" : "Older";
    groups.set(label, [...(groups.get(label) ?? []), chat]);
  }
  return GROUP_ORDER.flatMap((label) => {
    const items = groups.get(label);
    return items ? [{ label, chats: items }] : [];
  });
}

/** A chat's name in the list: its first question, cut at a word to about `max` characters. */
export function chatTitle(question: string, max = 44) {
  const text = question.replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

export type TextRun = { text: string; strong: boolean };

export type AnswerBlock =
  | { kind: "paragraph"; lines: TextRun[][] }
  | { kind: "list"; ordered: boolean; items: TextRun[][] };

/** A line's **bold** runs; everything else stays plain text, which React escapes. */
export function textRuns(line: string): TextRun[] {
  const runs: TextRun[] = [];
  let last = 0;
  for (const match of line.matchAll(/\*\*(.+?)\*\*/g)) {
    const start = match.index ?? 0;
    if (start > last) runs.push({ text: line.slice(last, start), strong: false });
    runs.push({ text: match[1], strong: true });
    last = start + match[0].length;
  }
  if (last < line.length) runs.push({ text: line.slice(last), strong: false });
  return runs;
}

const BULLET = /^[-*•]\s+(.+)$/;
const NUMBERED = /^\d{1,3}[.)]\s+(.+)$/;
const HEADING = /^#{1,6}\s+(.+)$/;

/**
 * The answer's text as paragraphs and lists. Models write a little Markdown: "- " and "1. "
 * lists, **bold** and the odd "## heading" (shown bold). Nothing else is interpreted, and
 * nothing becomes HTML. A blank line ends a paragraph or a list.
 */
export function answerBlocks(text: string): AnswerBlock[] {
  const blocks: AnswerBlock[] = [];
  let open = false;
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) {
      open = false;
      continue;
    }
    const last = open ? blocks.at(-1) : undefined;
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    const item = bullet ?? numbered;
    if (item) {
      const ordered = Boolean(numbered);
      if (last?.kind === "list" && last.ordered === ordered) last.items.push(textRuns(item[1]));
      else blocks.push({ kind: "list", ordered, items: [textRuns(item[1])] });
    } else {
      const heading = HEADING.exec(line);
      const runs = heading ? [{ text: heading[1].replace(/\*\*/g, ""), strong: true }] : textRuns(line);
      if (last?.kind === "paragraph" && !heading) last.lines.push(runs);
      else blocks.push({ kind: "paragraph", lines: [runs] });
    }
    open = true;
  }
  return blocks;
}
