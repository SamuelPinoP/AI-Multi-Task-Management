// Every tool the AI assistant can call (#307). The agent loop knows tools only
// through this list, so new ones (such as the GitHub tools planned for later)
// are added here without touching the loop. The write tools (#310) only propose
// changes, which the person applies in the app.
import { CHANGE_TOOLS } from "@/lib/ai/tools/change-tools";
import type { AgentTool } from "@/lib/ai/tools/define";
import { getTask, listEvents, listGoals, listOpenTasks, listProjects, searchNotes, taskStats } from "@/lib/ai/tools/read-tools";
import { WRITE_TOOLS } from "@/lib/ai/tools/write-tools";

export const AGENT_TOOLS: AgentTool[] = [listOpenTasks, listEvents, listProjects, taskStats, searchNotes, listGoals, ...WRITE_TOOLS];

/**
 * What AI apps connected over MCP can call: the assistant's read tools, the same objects, plus
 * get_task (#478), and the write tools that make changes themselves (#479), with the person's
 * permission. The "propose" tools stay in the app, where the person applies what they propose.
 */
export const MCP_TOOLS: AgentTool[] = [...AGENT_TOOLS.filter((tool) => tool.access === "read"), getTask, ...(CHANGE_TOOLS as AgentTool[])];
