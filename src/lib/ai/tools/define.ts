// How the AI assistant's tools are defined (#307). Each tool's input is one Zod
// schema: it describes the tool to the model (as JSON Schema) and validates the
// model's arguments before the tool runs, so invalid arguments never reach the
// database. The person's id comes from their session, through `ToolContext`.
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import type { ProposalDraft } from "@/lib/ai/proposals";
import type { ToolDefinition } from "@/lib/ai/types";

/** The database the tools read: only the models they need, so tests can pass a stand-in. They never write. */
export type ToolDb = Pick<PrismaClient, "task" | "event" | "project" | "note" | "weeklyGoal">;

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
};

export type AgentTool<Input extends z.ZodType = z.ZodType> = {
  /** Letters, digits and underscores, as every provider accepts. */
  name: string;
  /** Shown while the tool runs, such as "Checking your open tasks". */
  label: string;
  description: string;
  input: Input;
  /**
   * "read" tools look things up. "propose" tools (#310) look up what a change needs and add it to
   * the answer's proposal (`ToolContext.draft`), which only the person can apply, in the app. No
   * tool changes anything.
   */
  access: "read" | "propose";
  /** Runs before the other calls the model makes at the same time, which may need what it adds. */
  runsFirst?: boolean;
  run(args: z.output<Input>, context: ToolContext): Promise<ToolOutput>;
};

export function defineTool<Input extends z.ZodType>(tool: AgentTool<Input>): AgentTool<Input> {
  return tool;
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
