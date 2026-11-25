import { handleMcpRequest } from "@/lib/mcp/server";

// AI Multi's MCP server (#478), for AI apps such as Claude, ChatGPT, Codex and Cursor. Off unless
// MCP_ENABLED is "true"; see src/lib/mcp/handler.ts. Stateless Streamable HTTP: apps POST
// JSON-RPC, and GET and DELETE (sessions, in the 2025 protocol) answer 405.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export { handleMcpRequest as DELETE, handleMcpRequest as GET, handleMcpRequest as POST };
