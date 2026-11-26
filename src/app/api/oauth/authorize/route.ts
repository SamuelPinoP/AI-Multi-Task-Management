import { getSessionUser } from "@/lib/auth";
import { oauthServer } from "@/lib/mcp/oauth-routes";

// Allow and Cancel on the consent page, /oauth/authorize (#477). Answers with a 303 back to the
// app. Off unless MCP_ENABLED is "true"; see src/lib/mcp/oauth-server.ts.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(request: Request) {
  return oauthServer.decide(request, getSessionUser);
}
