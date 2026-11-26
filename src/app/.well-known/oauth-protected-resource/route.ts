import { oauthServer } from "@/lib/mcp/oauth-routes";
import { preflight } from "@/lib/mcp/oauth-server";

// The MCP endpoint's protected resource metadata (RFC 9728, #477), at the root for apps that look
// here before /.well-known/oauth-protected-resource/api/mcp. Off unless MCP_ENABLED is "true".
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return oauthServer.protectedResourceMetadata(request);
}

export function OPTIONS() {
  return preflight();
}
