import { oauthServer } from "@/lib/mcp/oauth-routes";
import { preflight } from "@/lib/mcp/oauth-server";

// AI apps trade a consent code, or a refresh token, for an access token here (#477). Off unless
// MCP_ENABLED is "true"; see src/lib/mcp/oauth-server.ts.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(request: Request) {
  return oauthServer.token(request);
}

export function OPTIONS() {
  return preflight();
}
