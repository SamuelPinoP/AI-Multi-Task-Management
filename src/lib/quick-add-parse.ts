/**
 * Natural-language quick add (SMART-01): "Draft slides fri 3pm #Capstone !high @Dana"
 * becomes a title plus a due date, project, priority and assignee.
 *
 * - Dates come from chrono-node. Tasks have no time, so a time alone ("3pm") is
 *   ignored and "fri 3pm" keeps only the day.
 * - `#project` matches a project name, ignoring case, spaces and punctuation;
 *   a unique prefix is enough ("#cap" for "Capstone Project").
 * - `!high`, `!medium` and `!low` (or `!h`, `!m`, `!l`, `!1` to `!3`) set the priority.
 * - `@person` matches a member of the chosen project by name or email.
 *
 * Anything that doesn't resolve stays in the title. `ignore` lets the user keep
 * a token as plain text after seeing the chips.
 */

import * as chrono from "chrono-node";

export type QuickAddPriority = "LOW" | "MEDIUM" | "HIGH";
export type QuickAddKind = "date" | "project" | "priority" | "assignee";

export type QuickAddProject = { id: string; name: string };
export type QuickAddMember = { id: string; name: string; email?: string | null };

export type QuickAddHint = { kind: "project" | "assignee"; token: string; message: string };

export type QuickAddResult = {
  title: string;
  /** `YYYY-MM-DD` in the browser's calendar, or null. */
  dueDate: string | null;
  /** The words the date was read from, e.g. "fri 3pm". */
  dueText: string | null;
  priority: QuickAddPriority | null;
  priorityText: string | null;
  project: QuickAddProject | null;
  projectText: string | null;
  assignee: QuickAddMember | null;
  assigneeText: string | null;
  /** Tokens that looked like `#project` or `@person` but matched nothing. */
  hints: QuickAddHint[];
};

export type QuickAddOptions = {
  now?: Date;
  /** Projects the user can add tasks to. */
  projects?: QuickAddProject[];
  /**
   * Members of the matched project, once loaded. `undefined` means "not loaded
   * yet", so `@person` stays pending without a hint.
   */
  members?: QuickAddMember[];
  /** Kinds the user chose to keep as plain text. */
  ignore?: ReadonlySet<QuickAddKind>;
};

const PRIORITY_WORDS: Record<string, QuickAddPriority> = {
  high: "HIGH", hi: "HIGH", h: "HIGH", urgent: "HIGH", "1": "HIGH",
  medium: "MEDIUM", med: "MEDIUM", m: "MEDIUM", normal: "MEDIUM", "2": "MEDIUM",
  low: "LOW", lo: "LOW", l: "LOW", "3": "LOW",
};

// A token starts the text or follows whitespace, so "a@b.com" and "C#" stay put.
const PROJECT_TOKEN = /(^|\s)#([\p{L}\p{N}][\p{L}\p{N}_.\-/]*)/gu;
const PRIORITY_TOKEN = /(^|\s)!([a-z0-9]+)(?=\s|$)/giu;
const PERSON_TOKEN = /(^|\s)@([\p{L}\p{N}][\p{L}\p{N}_.\-']*)/gu;
// "due fri", "by Friday", "on oct 30": drop the connecting word with the date.
const DATE_LEAD_IN = /(?:^|\s)(?:due|by|on|before|until|for)\s*$/i;

/** Lowercase letters and digits only, so "Capstone-Project" equals "capstone project". */
export function normalizeQuickAddName(value: string) {
  return value.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}]/gu, "");
}

function toDateInput(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

type Span = { start: number; end: number };

/** Finds the first match of a token pattern, as the span to cut and the bare token. */
function findToken(text: string, pattern: RegExp, accept: (token: string) => boolean = () => true) {
  pattern.lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    const token = match[2];
    if (!accept(token)) continue;
    const start = (match.index ?? 0) + match[1].length;
    return { token, span: { start, end: start + 1 + token.length } };
  }
  return null;
}

function matchProject(token: string, projects: QuickAddProject[]): QuickAddProject | "ambiguous" | null {
  const key = normalizeQuickAddName(token);
  if (!key) return null;
  const exact = projects.filter((project) => normalizeQuickAddName(project.name) === key);
  if (exact.length) return exact[0];
  const prefix = projects.filter((project) => normalizeQuickAddName(project.name).startsWith(key));
  if (prefix.length === 1) return prefix[0];
  return prefix.length > 1 ? "ambiguous" : null;
}

function matchMember(token: string, members: QuickAddMember[]): QuickAddMember | "ambiguous" | null {
  const key = normalizeQuickAddName(token);
  if (!key) return null;
  const names = (member: QuickAddMember) => {
    const parts = member.name.split(/\s+/).map(normalizeQuickAddName).filter(Boolean);
    const emailName = member.email ? normalizeQuickAddName(member.email.split("@")[0]) : "";
    return { full: normalizeQuickAddName(member.name), parts, emailName };
  };
  const exact = members.filter((member) => {
    const { full, parts, emailName } = names(member);
    return full === key || parts.includes(key) || emailName === key;
  });
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return "ambiguous";
  const prefix = members.filter((member) => {
    const { full, parts } = names(member);
    return full.startsWith(key) || parts.some((part) => part.startsWith(key));
  });
  if (prefix.length === 1) return prefix[0];
  return prefix.length > 1 ? "ambiguous" : null;
}

/** Removes the spans from the text and tidies the spaces left behind. */
function cut(text: string, spans: Span[]) {
  let result = text;
  for (const span of [...spans].sort((a, b) => b.start - a.start)) {
    result = `${result.slice(0, span.start)} ${result.slice(span.end)}`;
  }
  return result.replace(/\s+/g, " ").trim();
}

export function parseQuickAdd(text: string, options: QuickAddOptions = {}): QuickAddResult {
  const now = options.now ?? new Date();
  const ignore = options.ignore ?? new Set<QuickAddKind>();
  const spans: Span[] = [];
  const hints: QuickAddHint[] = [];
  const result: QuickAddResult = {
    title: text.trim(),
    dueDate: null,
    dueText: null,
    priority: null,
    priorityText: null,
    project: null,
    projectText: null,
    assignee: null,
    assigneeText: null,
    hints,
  };

  if (!ignore.has("priority")) {
    const found = findToken(text, PRIORITY_TOKEN, (token) => token.toLowerCase() in PRIORITY_WORDS);
    if (found) {
      result.priority = PRIORITY_WORDS[found.token.toLowerCase()];
      result.priorityText = `!${found.token}`;
      spans.push(found.span);
    }
  }

  if (!ignore.has("project")) {
    const found = findToken(text, PROJECT_TOKEN);
    if (found) {
      const project = matchProject(found.token, options.projects ?? []);
      if (project && project !== "ambiguous") {
        result.project = project;
        result.projectText = `#${found.token}`;
        spans.push(found.span);
      } else if (!/^\d+$/.test(found.token) && options.projects) {
        // "#12" is usually an issue number, not a project; say nothing about it.
        hints.push({
          kind: "project",
          token: `#${found.token}`,
          message: project === "ambiguous" ? `#${found.token} matches several projects` : `No project called #${found.token}`,
        });
      }
    }
  }

  if (!ignore.has("assignee")) {
    const found = findToken(text, PERSON_TOKEN);
    if (found) {
      if (!result.project) {
        hints.push({ kind: "assignee", token: `@${found.token}`, message: `Add a #project to assign @${found.token}` });
      } else if (options.members) {
        const member = matchMember(found.token, options.members);
        if (member && member !== "ambiguous") {
          result.assignee = member;
          result.assigneeText = `@${found.token}`;
          spans.push(found.span);
        } else {
          hints.push({
            kind: "assignee",
            token: `@${found.token}`,
            message:
              member === "ambiguous"
                ? `@${found.token} matches several people in ${result.project.name}`
                : `No one called @${found.token} in ${result.project.name}`,
          });
        }
      }
    }
  }

  if (!ignore.has("date")) {
    // Hide the tokens first so "#Q4" or "!1" can't be read as dates.
    const masked = spans.reduce(
      (current, span) => current.slice(0, span.start) + " ".repeat(span.end - span.start) + current.slice(span.end),
      text,
    );
    const parsed = chrono
      .parse(masked, now, { forwardDate: true })
      .find((item) => item.start.isCertain("day") || item.start.isCertain("weekday"));
    if (parsed) {
      const start = parsed.index;
      const leadIn = masked.slice(0, start).match(DATE_LEAD_IN);
      const spanStart = leadIn ? start - leadIn[0].trimStart().length : start;
      result.dueDate = toDateInput(parsed.start.date());
      result.dueText = parsed.text;
      spans.push({ start: spanStart, end: start + parsed.text.length });
    }
  }

  const title = cut(text, spans);
  // Never save an empty title: if everything was a token, keep the text as typed.
  result.title = title || text.trim();
  return result;
}
