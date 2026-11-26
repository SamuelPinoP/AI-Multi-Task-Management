import { oauthServer } from "@/lib/mcp/oauth-routes";
import { preflight } from "@/lib/mcp/oauth-server";

// Token revocation (RFC 7009, #477): an app signing out ends its connection on that device. Off
// unless MCP_ENABLED is "true"; see src/lib/mcp/oauth-server.ts.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(request: Request) {
  return oauthServer.revoke(request);
}

export function OPTIONS() {
  return preflight();
}
