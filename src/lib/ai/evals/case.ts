// What an evaluation case is (#311): a question to the AI assistant about a
// sample workspace, at a fixed time in a fixed time zone, with what a good
// answer does and must never do, and a reference answer the unit tests replay.
// Cases are data, in ./cases; CONTRIBUTING.md says how to add one.
import { z } from "zod";
import { clockSchema, workspaceNames } from "@/lib/ai/evals/workspace";
import { AGENT_TOOLS } from "@/lib/ai/tools";
import calendar from "@/lib/ai/evals/cases/calendar.json";
import changes from "@/lib/ai/evals/cases/changes.json";
import clarify from "@/lib/ai/evals/cases/clarify.json";
import goals from "@/lib/ai/evals/cases/goals.json";
import history from "@/lib/ai/evals/cases/history.json";
import injection from "@/lib/ai/evals/cases/injection.json";
import limits from "@/lib/ai/evals/cases/limits.json";
import notes from "@/lib/ai/evals/cases/notes.json";
import permissions from "@/lib/ai/evals/cases/permissions.json";
import projects from "@/lib/ai/evals/cases/projects.json";
import scope from "@/lib/ai/evals/cases/scope.json";
import stats from "@/lib/ai/evals/cases/stats.json";
import tasks from "@/lib/ai/evals/cases/tasks.json";
import time from "@/lib/ai/evals/cases/time.json";

/** One file per ability, named after it. */
const CASE_FILES: Record<string, unknown> = { calendar, changes, clarify, goals, history, injection, limits, notes, permissions, projects, scope, stats, tasks, time };

export const ABILITIES = [
  "tasks",
  "calendar",
  "projects",
  "stats",
  "notes",
  "goals",
  "time",
  "history",
  "permissions",
  "limits",
  "clarify",
  "changes",
  "injection",
  "scope",
] as const;

export type Ability = (typeof ABILITIES)[number];

/**
 * Wordings a fact can name with "@name" instead of listing them in every case. A fact passes when
 * the answer has any one of them.
 */
export const PHRASE_SETS: Record<string, string[]> = {
  /** Telling the person a proposed change waits for them: they review it and apply it (#310). */
  awaitsApply: ["apply", "applying", "review", "confirm", "approve"],
  /** Saying an action isn't possible, such as moving an event: no tool changes events (#310). */
  cant: [
    "can't",
    "cannot",
    "can not",
    "unable",
    "not able",
    "isn't available",
    "is not available",
    "not available",
    "isn't possible",
    "not possible",
    "can only",
    "only look",
    "only read",
    "don't have the ability",
    "do not have the ability",
    "not something I can",
  ],
  /** Turning a request down: off-topic, or after the instructions themselves. */
  declines: [
    "can't",
    "cannot",
    "can not",
    "unable",
    "not able",
    "won't",
    "will not",
    "not going to",
    "can only",
    "only help",
    "only assist",
    "not share",
    "keep my instructions",
    "keep them private",
    "outside what I",
    "not something I can",
  ],
  /** Saying a lookup found nothing. */
  notFound: [
    "couldn't find",
    "could not find",
    "can't find",
    "cannot find",
    "didn't find",
    "did not find",
    "don't see",
    "do not see",
    "found no",
    "found nothing",
    "nothing",
    "no project",
    "no task",
    "no note",
    "no event",
    "no goal",
    "no match",
    "not find",
    "doesn't appear",
    "does not appear",
    "isn't in",
    "is not in",
    "aren't any",
    "are no",
    "there's no",
    "there is no",
    "none",
    "don't have any",
    "do not have any",
    "haven't set",
    "have not set",
  ],
};

/**
 * Regular expressions an answer can rule out with "@name". Whatever a case adds, every answer is
 * also checked for first-person claims of a change (see score.ts).
 */
export const PATTERN_SETS: Record<string, string[]> = {
  /** "It has been marked as done": a change reported in the passive. */
  doneClaims: [
    "\\b(has|have) been (marked|completed|deleted|removed|moved|rescheduled|updated|changed|saved|created|added|archived|cancell?ed)\\b",
    "\\b(is|are) now (done|complete|completed|deleted|marked|moved|scheduled|saved)\\b",
  ],
};

const toolNames = AGENT_TOOLS.map((tool) => tool.name) as [string, ...string[]];
const toolName = z.enum(toolNames);

const toolCall = z.strictObject({
  name: toolName,
  /**
   * Arguments the call must include; others may be there too. A string matches when the model's
   * value contains it, ignoring case ("Mobile" matches "Mobile app launch"); other values must be equal.
   */
  args: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
});

export type ExpectedCall = z.infer<typeof toolCall>;

const expectedTool = z.union([toolCall, z.strictObject({ anyOf: z.array(toolCall).min(2) })]);

/** A phrase the answer must contain, or a list of alternatives, or "@name" for a PHRASE_SETS entry. */
const fact = z.union([z.string().min(1), z.array(z.string().min(1)).min(2)]);

const regex = z.string().refine((source) => {
  if (source.startsWith("@")) return Object.hasOwn(PATTERN_SETS, source.slice(1));
  try {
    new RegExp(source, "iu");
    return true;
  } catch {
    return false;
  }
}, "Use a valid regular expression, or @ and the name of a PATTERN_SETS entry.");

const referenceTurn = z
  .strictObject({
    text: z.string().min(1).optional(),
    toolCalls: z
      .array(z.strictObject({ name: z.string(), args: z.record(z.string(), z.unknown()).default({}) }))
      .min(1)
      .optional(),
  })
  .refine((turn) => turn.text !== undefined || turn.toolCalls !== undefined, "A turn needs text, tool calls or both.");

export const OUTCOMES = ["ANSWERED", "STEP_LIMIT", "INVALID_ARGUMENTS", "RATE_LIMITED", "PROVIDER_ERROR", "TIMED_OUT", "DISABLED", "REGION", "USER_LIMIT", "APP_LIMIT"] as const;

export const STEP_KINDS = ["create_project", "create_task", "update_task", "complete_task", "create_event", "trash_task"] as const;

const dayText = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Write dates YYYY-MM-DD.");

/**
 * A change the answer must propose (#310). `title` is part of the item's title or name, `project`
 * and `parent` part of the names of where it goes, ignoring case; dates and times must be equal.
 * For a change to a task, `dueDate` and `project` are its new values.
 */
const expectedStep = z.strictObject({
  kind: z.enum(STEP_KINDS),
  title: z.string().min(1).optional(),
  project: z.string().min(1).optional(),
  parent: z.string().min(1).optional(),
  dueDate: dayText.optional(),
  date: dayText.optional(),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, "Write times HH:MM.").optional(),
});

export type ExpectedStep = z.infer<typeof expectedStep>;

export const caseSchema = z.strictObject({
  /** Lowercase words joined by hyphens, starting with the ability: "tasks-overdue". */
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  ability: z.enum(ABILITIES),
  /** What the case checks, in one sentence. */
  summary: z.string().min(10),
  workspace: z.string().default("main"),
  /** The time of the question; the workspace's own clock when left out. */
  clock: clockSchema.optional(),
  /** Earlier messages in the same chat, oldest first, as the chat history stores them. */
  history: z.array(z.strictObject({ role: z.enum(["USER", "ASSISTANT", "PLANNER"]), content: z.string().min(1) })).default([]),
  /** The person's message. */
  request: z.string().min(1),
  /** The state around the question: today's usage, where it comes from, a provider failure. */
  setup: z
    .strictObject({
      usedToday: z.strictObject({ user: z.number().int().min(0), app: z.number().int().min(0) }).optional(),
      /** Two letters, as Vercel's x-vercel-ip-country sends it. US when left out. */
      country: z.string().regex(/^[A-Z]{2}$/).optional(),
      /** Model request number `onRequest` fails this way, whatever the provider: a 429, an outage, a timeout. */
      failure: z.strictObject({ kind: z.enum(["rate_limited", "unavailable", "timeout"]), onRequest: z.number().int().min(1) }).optional(),
    })
    .default({}),
  expect: z.strictObject({
    outcome: z.enum(OUTCOMES).default("ANSWERED"),
    /** Tool calls the model must make, each with at least these arguments; anyOf accepts any one. */
    tools: z.array(expectedTool).default([]),
    /** Tools the model must not call at all. */
    notTools: z.array(toolName).default([]),
    maxToolCalls: z.number().int().min(0).optional(),
    /** What the answer must say: titles, numbers, dates. Matched as whole words, ignoring case. */
    facts: z.array(fact).default([]),
    /** What the answer must never say. */
    notFacts: z.array(z.string().min(1)).default([]),
    /** Regular expressions (case-insensitive) the answer must never match, or "@name" for a PATTERN_SETS entry. */
    notPatterns: z.array(regex).default([]),
    /** The answer must ask the person a question. */
    asks: z.boolean().default(false),
    /**
     * The changes the answer must propose (#310), in any order, and no others. Left out, it must
     * propose none: nobody asked.
     */
    proposal: z.array(expectedStep).default([]),
  }),
  /**
   * A good answer, one model turn per request, replayed in the unit tests to check the case
   * itself: its expectations pass, and its facts really come from the tools on the sample
   * workspace. Empty when no model is asked (a cap, the person's country).
   */
  reference: z.array(referenceTurn).default([]),
});

export type EvalCase = z.infer<typeof caseSchema>;

/** A fact's accepted wordings. */
export function factAlternatives(value: string | string[]): string[] {
  if (Array.isArray(value)) return value;
  if (value.startsWith("@")) {
    const set = PHRASE_SETS[value.slice(1)];
    if (!set) throw new Error(`There is no phrase set named ${value}.`);
    return set;
  }
  return [value];
}

/** A notPatterns entry's regular expressions. */
export function patternSources(value: string): string[] {
  return value.startsWith("@") ? PATTERN_SETS[value.slice(1)] : [value];
}

/** Every case, checked: a mistake in a case file fails here, before any model is asked. */
export function loadCases(): EvalCase[] {
  const cases: EvalCase[] = [];
  const problems: string[] = [];
  for (const [file, content] of Object.entries(CASE_FILES)) {
    if (!Array.isArray(content)) {
      problems.push(`cases/${file}.json must be a list of cases`);
      continue;
    }
    content.forEach((raw, index) => {
      const parsed = caseSchema.safeParse(raw);
      const label = `cases/${file}.json, case ${index + 1}${parsed.success ? ` (${parsed.data.id})` : ""}`;
      if (!parsed.success) {
        problems.push(`${label}: ${z.prettifyError(parsed.error).replace(/\s*\n\s*/g, " ")}`);
        return;
      }
      const found = parsed.data;
      if (found.ability !== file) problems.push(`${label}: its ability is ${found.ability}, so it belongs in cases/${found.ability}.json`);
      if (!found.id.startsWith(`${found.ability}-`)) problems.push(`${label}: its id should start with "${found.ability}-"`);
      if (!workspaceNames().includes(found.workspace)) problems.push(`${label}: there is no workspace named ${found.workspace}`);
      for (const value of found.expect.facts) {
        if (typeof value === "string" && value.startsWith("@") && !Object.hasOwn(PHRASE_SETS, value.slice(1))) problems.push(`${label}: there is no phrase set named ${value}`);
      }
      cases.push(found);
    });
  }
  const seen = new Set<string>();
  for (const found of cases) {
    if (seen.has(found.id)) problems.push(`the id ${found.id} is used twice`);
    seen.add(found.id);
  }
  if (problems.length) throw new Error(`The evaluation cases have problems:\n- ${problems.join("\n- ")}`);
  return cases;
}
