// Every tool the AI assistant can call (#307). The agent loop knows tools only
// through this list, so new ones (the actions of #310, the GitHub tools planned
// for later) are added here without touching the loop.
import type { AgentTool } from "@/lib/ai/tools/define";
import { listEvents, listGoals, listOpenTasks, listProjects, searchNotes } from "@/lib/ai/tools/read-tools";

export const AGENT_TOOLS: AgentTool[] = [listOpenTasks, listEvents, listProjects, searchNotes, listGoals];
