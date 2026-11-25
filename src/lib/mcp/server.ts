import "server-only";

import { createMcpEndpoint } from "@/lib/mcp/handler";
import { prisma } from "@/lib/prisma";

/** /api/mcp with the real database. It reads MCP_ENABLED and MCP_TOKEN_SECRET on every request. */
export const handleMcpRequest = createMcpEndpoint({ env: process.env, db: prisma });
