import { oauthServer } from "@/lib/mcp/oauth-routes";
import { preflight } from "@/lib/mcp/oauth-server";

// The MCP endpoint's protected resource metadata (RFC 9728, #477), where its 401 points
// (RESOURCE_METADATA_PATH in src/lib/mcp/handler.ts). Off unless MCP_ENABLED is "true".
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return oauthServer.protectedResourceMetadata(request);
}

export function OPTIONS() {
  return preflight();
}
