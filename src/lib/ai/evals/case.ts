// What an evaluation case is (#311): a question to the AI assistant about a
// sample workspace, at a fixed time in a fixed time zone, with what a good
// answer does and must never do, and a reference answer the unit tests replay.
// Cases are data, in ./cases; CONTRIBUTING.md says how to add one.
import { z } from "zod";
import { buttonPlan, followPlan, type EstimatePlan } from "@/lib/ai/estimate-core";
import { clockSchema, workspaceNames } from "@/lib/ai/evals/workspace";
import { AGENT_TOOLS } from "@/lib/ai/tools";
import { ESTIMATE_STEPS, stepMinutes } from "@/lib/estimates";
import calendar from "@/lib/ai/evals/cases/calendar.json";
import changes from "@/lib/ai/evals/cases/changes.json";
import clarify from "@/lib/ai/evals/cases/clarify.json";
import estimates from "@/lib/ai/evals/cases/estimates.json";
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
import tickets from "@/lib/ai/evals/cases/tickets.json";
import time from "@/lib/ai/evals/cases/time.json";

/** One file per ability, named after it. */
const CASE_FILES: Record<string, unknown> = { calendar, changes, clarify, estimates, goals, history, injection, limits, notes, permissions, projects, scope, stats, tasks, tickets, time };

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
  "tickets",
  "estimates",
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
  /**
   * Facts a ticket states that a short request rarely gives (#433): dates, amounts of money,
   * percentages and time limits. Checked outside its Open questions and the person's own words.
   */
  inventedFacts: [
    "\\b\\d{4}-\\d{2}-\\d{2}\\b",
    "\\b(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sep(t|tember)?|oct(ober)?|nov(ember)?|dec(ember)?) \\d{1,2}(st|nd|rd|th)?\\b",
    "[$€£¥] ?\\d",
    "\\b\\d+(\\.\\d+)? ?(%|percent\\b)",
    "\\b(within|under|in less than|no more than|at most) \\d+(\\.\\d+)? ?(ms|milliseconds?|s|secs?|seconds?|mins?|minutes?|hours?|days?|weeks?)\\b",
  ],
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
   * An item's id, or a ref to an item the same answer creates ("new-1"), stands for its title or name.
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
 * The range an estimate must land in, both ends included (#434). An estimate is a judgment, so a
 * case gives a range, never one step: "fix a typo on the pricing page" is 15 min to 1 h.
 */
const estimateRange = z
  .strictObject({ min: z.enum(ESTIMATE_STEPS), max: z.enum(ESTIMATE_STEPS) })
  .refine(({ min, max }) => stepMinutes(min) <= stepMinutes(max), "Give the shorter step as min.");

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
  /** For a new task written as a ticket (#433): what its description must have. */
  ticket: z
    .strictObject({
      /** Section titles it must have, in this order; others may come between. */
      sections: z.array(z.string().min(1)).min(1),
      /** At least this many acceptance criteria. */
      minCriteria: z.number().int().min(1).optional(),
      /** At least this many open questions: what the request leaves open. */
      minQuestions: z.number().int().min(1).optional(),
      /**
       * Regular expressions, or "@name" for a PATTERN_SETS entry, that its text must never match
       * outside Open questions, the Estimate and the Original request: facts the request didn't give.
       */
      notInvented: z.array(regex).default([]),
    })
    .optional(),
  /**
   * For a new task, a ticket or not (#434): the range its estimate must land in, marked as the AI's,
   * or false when it must have none, as a subtask of a task without one.
   */
  estimate: z.union([estimateRange, z.literal(false)]).optional(),
  /** For a new task: whether it comes with 2 to 5 subtasks that split it, offered unticked. Only work over 2 days does (#434). */
  split: z.boolean().optional(),
}).refine((step) => step.kind === "create_task" || (step.estimate === undefined && step.split === undefined), "Only a new task (create_task) has an estimate or a split.");

export type ExpectedStep = z.infer<typeof expectedStep>;

/** A task or subtask as an estimate request reads it: its title, and its description as stored. */
const estimateItem = {
  title: z.string().min(1),
  /** Markdown sections included: an Estimate section with text in it means it has an estimate already. */
  description: z.string().min(1).nullable().default(null),
};

/**
 * An estimate request (#540) in place of a chat message, sent by the code the server runs
 * (src/lib/ai/estimate-core.ts). "button" is the Estimate button: the task, and its subtasks without
 * an estimate. "follow" is a task with an estimate passing it on: to its subtasks without one, or
 * only to those marked `added`, just created.
 */
const estimateRequest = z.strictObject({
  kind: z.enum(["button", "follow"]),
  task: z.strictObject({
    ...estimateItem,
    /** Whether it's a subtask itself, which has none of its own. */
    subtask: z.boolean().default(false),
  }),
  subtasks: z.array(z.strictObject({ ...estimateItem, added: z.boolean().default(false) })).default([]),
});

export type EstimateRequest = z.infer<typeof estimateRequest>;

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
  /** The person's message; for an estimate request, what the person did, in words. */
  request: z.string().min(1),
  /** An estimate request instead of a chat message (#540), with `expect.estimates`. */
  estimate: estimateRequest.optional(),
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
    /** What the answer must say: titles, numbers, dates. Matched as whole words, ignoring case and Markdown emphasis. */
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
    /**
     * For an estimate request (#540): the range the task's own estimate must land in (the button
     * only), and each subtask's in order, or false for one that must get none.
     */
    estimates: z
      .strictObject({
        task: estimateRange.optional(),
        subtasks: z.array(z.union([estimateRange, z.literal(false)])).default([]),
      })
      .optional(),
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

/** The id an estimate case's task gets, and its subtasks'. The model reads refs ("task", "subtask-1"), never these. */
export const CASE_TASK_ID = "case-task";

export function caseSubtaskId(index: number) {
  return `case-subtask-${index + 1}`;
}

/** An estimate case's request as the server builds it; null when it has nothing to estimate. */
export function estimateCasePlan(estimate: EstimateRequest): EstimatePlan | null {
  const task = { id: CASE_TASK_ID, title: estimate.task.title, description: estimate.task.description };
  const subtasks = estimate.subtasks.map((subtask, index) => ({ id: caseSubtaskId(index), title: subtask.title, description: subtask.description }));
  if (estimate.kind === "button") return buttonPlan({ ...task, parentId: estimate.task.subtask ? "case-parent" : null }, subtasks);
  const added = subtasks.filter((_subtask, index) => estimate.subtasks[index].added).map((subtask) => subtask.id);
  return followPlan(task, subtasks, added.length ? added : undefined);
}

/**
 * What's wrong with an estimate case beyond its schema (#540): it must be a request the server would
 * send, expect an estimate for exactly the tasks that get one, and have nothing of a chat.
 */
export function estimateCaseProblems(found: EvalCase): string[] {
  const { estimate } = found;
  const expected = found.expect.estimates;
  if (found.ability !== "estimates") return estimate || expected ? ["only an estimates case has an estimate request or expect.estimates"] : [];
  if (!estimate) return ["an estimates case needs an estimate request"];
  const problems: string[] = [];
  const chat = [
    found.workspace !== "main" && "workspace",
    found.clock && "clock",
    found.history.length > 0 && "history",
    found.setup.usedToday && "setup.usedToday",
    found.setup.country && "setup.country",
    found.expect.tools.length > 0 && "expect.tools",
    found.expect.notTools.length > 0 && "expect.notTools",
    found.expect.maxToolCalls !== undefined && "expect.maxToolCalls",
    found.expect.facts.length > 0 && "expect.facts",
    found.expect.notFacts.length > 0 && "expect.notFacts",
    found.expect.notPatterns.length > 0 && "expect.notPatterns",
    found.expect.asks && "expect.asks",
    found.expect.proposal.length > 0 && "expect.proposal",
  ].filter((name): name is string => typeof name === "string");
  if (chat.length) problems.push(`an estimate request has no ${chat.join(", ")}: those are for chat messages`);
  if (estimate.task.subtask && estimate.subtasks.length) problems.push("a subtask has no subtasks of its own");
  if (estimate.kind === "button" && estimate.subtasks.some((subtask) => subtask.added)) problems.push("only a follow request has added subtasks");
  const plan = estimateCasePlan(estimate);
  if (!plan) problems.push(estimate.kind === "button" ? "the button shows only on a task without an estimate" : "a follow request needs a task with an estimate and a subtask to estimate");
  if (found.expect.outcome !== "ANSWERED") {
    if (expected) problems.push(`a request that ends as ${found.expect.outcome} estimates nothing: leave out expect.estimates`);
    return problems;
  }
  if (!expected) return [...problems, "give the ranges the estimates must land in, in expect.estimates"];
  if (estimate.kind === "button" && !expected.task) problems.push("the button estimates the task: give its range in expect.estimates.task");
  if (estimate.kind === "follow" && expected.task) problems.push("a follow request leaves the task's own estimate as it is: no expect.estimates.task");
  if (expected.subtasks.length !== estimate.subtasks.length) problems.push(`expect.estimates.subtasks needs one entry for each of the ${estimate.subtasks.length} subtasks`);
  if (!plan) return problems;
  estimate.subtasks.forEach((subtask, index) => {
    const asked = plan.targets.includes(caseSubtaskId(index));
    const wanted = expected.subtasks[index];
    if (wanted !== undefined && asked !== (wanted !== false)) problems.push(`"${subtask.title}" ${asked ? "gets an estimate: give its range" : "gets none: expect false"}`);
  });
  return problems;
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
      for (const problem of estimateCaseProblems(found)) problems.push(`${label}: ${problem}`);
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
