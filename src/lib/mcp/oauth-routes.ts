import "server-only";

import { createClientMetadataResolver } from "@/lib/mcp/client-metadata";
import { createOAuthServer } from "@/lib/mcp/oauth-server";
import { prismaOAuthStore } from "@/lib/mcp/oauth-store";
import { prisma } from "@/lib/prisma";
import { consumeRateLimit } from "@/lib/rate-limit";

/**
 * Sign-in for AI apps (#477) with the real database, rate limits and document fetches. One per
 * server, so apps' metadata documents stay cached between requests. It reads MCP_ENABLED and
 * MCP_TOKEN_SECRET on every request.
 */
export const oauthServer = createOAuthServer({
  env: process.env,
  store: prismaOAuthStore(prisma),
  resolveClientMetadata: createClientMetadataResolver(),
  rateLimit: consumeRateLimit,
});
