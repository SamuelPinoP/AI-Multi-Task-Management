import { oauthServer } from "@/lib/mcp/oauth-routes";
import { preflight } from "@/lib/mcp/oauth-server";

// Dynamic Client Registration (RFC 7591, #477), for AI apps without a Client ID Metadata Document.
// Off unless MCP_ENABLED is "true"; see src/lib/mcp/oauth-server.ts.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(request: Request) {
  return oauthServer.register(request);
}

export function OPTIONS() {
  return preflight();
}
