// The MCP endpoint, /api/mcp (#478), as a plain (Request) => Response function, so tests can call
// it without Next.js. Vercel's mcp-handler serves the protocol, statelessly: MCP 2026-07-28's
// server/discover, and the 2025 initialize handshake for older apps.
//
// Every request needs a valid access token. Checking one needs no database, so starting an app and
// listing the tools never wake Neon; tool calls then check the grant (tools.ts). Without a valid
// token the answer is 401 with a WWW-Authenticate challenge naming the protected resource metadata
// (RFC 9728), never a redirect. The whole endpoint is off unless MCP_ENABLED is "true".
import { OAuthError, OAuthErrorCode, type AuthInfo } from "@modelcontextprotocol/server";
import { createMcpHandler, getPublicOrigin, withMcpAuth } from "mcp-handler";
import { MIN_SECRET_LENGTH, verifyAccessToken, type TokenCheck } from "@/lib/mcp/access-token";
import { MCP_INSTRUCTIONS, registerMcpTools, type McpDb } from "@/lib/mcp/tools";

export const MCP_PATH = "/api/mcp";
/** Where the endpoint's protected resource metadata lives (RFC 9728 §3.1); sign-in (#477) serves it. */
export const RESOURCE_METADATA_PATH = `/.well-known/oauth-protected-resource${MCP_PATH}`;
export const MCP_SERVER_INFO = { name: "ai-multi", version: "1.0.0" };

type Env = Record<string, string | undefined>;

/** The switch: anything but "true" keeps the endpoint off. */
export function isMcpEnabled(env: Env) {
  return env.MCP_ENABLED?.trim() === "true";
}

/** The access tokens' signing secret, or null when it's missing or too short to be safe. */
export function mcpTokenSecret(env: Env) {
  const secret = env.MCP_TOKEN_SECRET?.trim();
  return secret && secret.length >= MIN_SECRET_LENGTH ? secret : null;
}

/** The site's address, which tokens are bound to and links point at: APP_BASE_URL, or the one this request came in on. */
export function appOrigin(env: Env, request: Request) {
  const configured = env.APP_BASE_URL?.trim();
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // The deploy check warns about a malformed APP_BASE_URL; fall back to the request's address.
    }
  }
  return getPublicOrigin(request);
}

const TOKEN_ERRORS: Record<Exclude<TokenCheck, { ok: true }>["reason"], string> = {
  malformed: "The access token isn't one AI Multi issued.",
  bad_signature: "The access token isn't one AI Multi issued.",
  expired: "The access token expired.",
  not_yet_valid: "The access token isn't valid yet.",
  wrong_resource: "The access token is for a different address.",
};

export function createMcpEndpoint({ env, db, now = () => new Date() }: { env: Env; db: McpDb; now?: () => Date }) {
  const serve = createMcpHandler((server) => registerMcpTools(server, { db, now }), {
    serverInfo: MCP_SERVER_INFO,
    instructions: MCP_INSTRUCTIONS,
  });

  return async function handleMcpRequest(request: Request): Promise<Response> {
    if (!isMcpEnabled(env)) return Response.json({ error: "Not found" }, { status: 404 });
    const secret = mcpTokenSecret(env);
    if (!secret) {
      // The deploy check refuses this combination, so it only happens on a server set up by hand.
      console.error("mcp_misconfigured", { missing: "MCP_TOKEN_SECRET" });
      return Response.json({ error: "The MCP server isn't set up." }, { status: 503 });
    }

    const origin = appOrigin(env, request);
    const resource = `${origin}${MCP_PATH}`;
    const verify = (_request: Request, token?: string): AuthInfo | undefined => {
      if (!token) return undefined;
      const check = verifyAccessToken(token, { secret, resource, now: now() });
      if (!check.ok) throw new OAuthError(OAuthErrorCode.InvalidToken, TOKEN_ERRORS[check.reason]);
      return {
        token,
        clientId: check.claims.clientId,
        scopes: check.claims.scopes,
        expiresAt: check.claims.expiresAt,
        resource: new URL(check.claims.resource),
        resourceMetadataUrl: `${origin}${RESOURCE_METADATA_PATH}`,
        extra: { userId: check.claims.userId, grantId: check.claims.grantId },
      };
    };
    return withMcpAuth(serve, verify, {
      required: true,
      // Every grant includes "read"; the challenge tells apps to ask for it.
      requiredScopes: ["read"],
      resourceUrl: origin,
      resourceMetadataPath: RESOURCE_METADATA_PATH,
    })(request);
  };
}
