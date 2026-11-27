// How the AI assistant's tools are defined (#307). Each tool's input is one Zod
// schema: it describes the tool to the model (as JSON Schema) and validates the
// model's arguments before the tool runs, so invalid arguments never reach the
// database. The person's id comes from their session, through `ToolContext`.
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import type { ProposalDraft } from "@/lib/ai/proposals";
import type { ToolWriter } from "@/lib/ai/tools/writer";
import type { ToolDefinition } from "@/lib/ai/types";

/**
 * The database the tools read: only the models they need, so tests can pass a stand-in. They never
 * write through it: connected AI apps' changes go through `ToolContext.writer` (#479).
 */
export type ToolDb = Pick<PrismaClient, "task" | "event" | "project" | "note" | "weeklyGoal" | "projectMember" | "label">;

export type ToolContext = {
  /** The signed-in person, from their session. Never from the model. */
  userId: string;
  /** The person's wall clock (see @/lib/user-time): it decides what "today" is. */
  now: Date;
  /** The real time, to compare with stored timestamps. */
  realNow: Date;
  timeZone: string | null;
  db: ToolDb;
  /**
   * The changes this answer proposes so far (#310), which "propose" tools add to. The chat starts
   * a new one for each message; without one, those tools refuse.
   */
  draft?: ProposalDraft;
  /** The person's message the answer replies to: a ticket quotes it as its Original request (#433). */
  request?: string;
  /**
   * How "write" tools make their change (#479): the app's shared write functions, as the person,
   * via the connected AI app, in one transaction. Only AI apps the person allowed to make changes
   * get one; without one, those tools refuse.
   */
  writer?: ToolWriter;
};

/** An item a tool looked up, as a link the chat panel can show (#308). Never sent to the model. */
export type Source = {
  kind: "task" | "event" | "project" | "note" | "goal";
  id: string;
  title: string;
  href: string;
};

export type ToolOutput = {
  /** What the model reads, marked as data on its way there. Only what a question needs. */
  data: unknown;
  sources: Source[];
  /** A "write" tool changed nothing because the change couldn't be made, and `data` says why. AI apps get an error result. */
  refused?: boolean;
};

export type AgentTool<Input extends z.ZodType = z.ZodType> = {
  /** Letters, digits and underscores, as every provider accepts. */
  name: string;
  /** Shown while the tool runs, such as "Checking your open tasks". */
  label: string;
  /** Its name for people, such as "Open tasks": AI apps connected over MCP show it (#478). */
  title?: string;
  description: string;
  input: Input;
  /**
   * "read" tools look things up. "propose" tools (#310) look up what a change needs and add it to
   * the answer's proposal (`ToolContext.draft`), which only the person can apply, in the app.
   * "write" tools (#479) make the change themselves, through `ToolContext.writer`: only AI apps
   * connected over MCP get them, where the app's own approval prompt is the person's confirmation.
   * The in-app assistant never does.
   */
  access: "read" | "propose" | "write";
  /**
   * For "write" tools, what AI apps show before a call: whether it removes something (moves it to
   * the Trash), and whether making the same call again changes nothing more.
   */
  writeHints?: { destructive: boolean; idempotent: boolean };
  /** Runs before the other calls the model makes at the same time, which may need what it adds. */
  runsFirst?: boolean;
  run(args: z.output<Input>, context: ToolContext): Promise<ToolOutput>;
};

export function defineTool<Input extends z.ZodType>(tool: AgentTool<Input>): AgentTool<Input> {
  return tool;
}

/** An argument the model left out another way: null, or text that is empty or only spaces. */
function isLeftOut(value: unknown) {
  return value === null || (typeof value === "string" && value.trim() === "");
}

/** One problem with an argument, on one line, with where it is inside the argument when it's a list or an object. */
function issueLine(issue: z.core.$ZodIssue) {
  return issue.path.length ? `${issue.message} (at ${issue.path.map(String).join(".")})` : issue.message;
}

/** Whether the schema the model sees for `schema` takes "" already: text with at most a length limit. */
function takesEmptyText(schema: z.ZodType) {
  const json = z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown>;
  return json.type === "string" && Object.keys(json).every((key) => ["$schema", "type", "maxLength", "description"].includes(key));
}

/**
 * An argument the model may leave out. Models also leave one out by sending "" or null (#504):
 * gpt-oss-120b sent task_stats both for its project, and Groq refused both calls, since it checks
 * every call against the tool's schema. So the schema the model sees allows null alongside
 * `schema`, and "" too where `schema` doesn't take it, and the tool gets undefined for them, as for
 * text with only spaces. Text needs no minimum length, then. Any other value is checked by
 * `schema`, with its own messages. Gemini gets the schema without those branches (geminiSchema).
 */
export function optionalArgument<T extends z.ZodType>(schema: T) {
  // Only for the schema the model sees: the step below turns these into undefined first.
  const leftOut: z.ZodType<undefined>[] = [z.null().transform(() => undefined)];
  if (!takesEmptyText(schema)) leftOut.push(z.string().max(0, { abort: true }).transform(() => undefined));
  const value = z.union([schema, ...leftOut], {
    // Only `schema` can match by then, so say what's wrong with the value rather than "Invalid input".
    error: (issue) => (issue.code === "invalid_union" ? issue.errors[0]?.map(issueLine).join("; ") : undefined),
  });
  return z.preprocess((given) => (isLeftOut(given) ? undefined : given), value.optional());
}

/** The tool as the model sees it. */
export function toolDefinition(tool: AgentTool): ToolDefinition {
  const { $schema: _version, ...parameters } = z.toJSONSchema(tool.input, { io: "input" }) as Record<string, unknown>;
  void _version;
  return { name: tool.name, description: tool.description, parameters };
}

/** The validation error the model gets back, short enough to act on. */
export function describeInvalidArguments(error: z.ZodError) {
  return `Invalid arguments. ${z.prettifyError(error).replace(/\s*\n\s*/g, " ")}`;
}
