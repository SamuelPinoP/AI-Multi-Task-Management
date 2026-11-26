import { oauthServer } from "@/lib/mcp/oauth-routes";
import { preflight } from "@/lib/mcp/oauth-server";

// How AI apps find sign-in (RFC 8414, #477): the consent page, token, registration and revocation
// addresses. Open to signed-out visitors (src/proxy.ts skips /.well-known/). Off unless MCP_ENABLED is "true".
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return oauthServer.authorizationServerMetadata(request);
}

export function OPTIONS() {
  return preflight();
}
