// How the AI assistant's tools are defined (#307). Each tool's input is one Zod
// schema: it describes the tool to the model (as JSON Schema) and validates the
// model's arguments before the tool runs, so invalid arguments never reach the
// database. The person's id comes from their session, through `ToolContext`.
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import type { ToolDefinition } from "@/lib/ai/types";

/** The database the tools read: only the models they need, so tests can pass a stand-in. */
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
   * "read" tools run as soon as the model calls them. Tools that change data (#310) will only
   * propose changes for the person to confirm in the app, and the loop runs nothing else.
   */
  access: "read";
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
