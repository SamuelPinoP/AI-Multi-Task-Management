// Every tool the AI assistant can call (#307). The agent loop knows tools only
// through this list, so new ones (such as the GitHub tools planned for later)
// are added here without touching the loop. The write tools (#310) only propose
// changes, which the person applies in the app.
import type { AgentTool } from "@/lib/ai/tools/define";
import { listEvents, listGoals, listOpenTasks, listProjects, searchNotes, taskStats } from "@/lib/ai/tools/read-tools";
import { WRITE_TOOLS } from "@/lib/ai/tools/write-tools";

export const AGENT_TOOLS: AgentTool[] = [listOpenTasks, listEvents, listProjects, taskStats, searchNotes, listGoals, ...WRITE_TOOLS];
