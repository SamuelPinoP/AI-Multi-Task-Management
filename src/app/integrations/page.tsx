import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { IntegrationsView } from "@/components/integrations/integrations-view";
import { requirePageUser } from "@/lib/auth";
import { configuredOrigin, isMcpEnabled, MCP_PATH, originFromHeaders } from "@/lib/mcp/connect";
import { listConnectedApps } from "@/lib/mcp/oauth-store";
import { prisma } from "@/lib/prisma";

/**
 * Integrations (#480, design 1A): how to connect an AI app to AI Multi's MCP server, with each app's
 * steps opening in its row (2A), and the apps already connected, with Disconnect (4C, #477). It
 * exists only while MCP_ENABLED is on; otherwise it's the normal 404, and nothing links to it.
 * GitHub (#485) and the imports (#492) join it later.
 */
export default async function IntegrationsPage() {
  if (!isMcpEnabled(process.env)) notFound();
  const user = await requirePageUser();
  // The address apps' tokens are bound to (handler.ts): APP_BASE_URL, or the one this page was opened at.
  const origin = configuredOrigin(process.env) ?? originFromHeaders(await headers()) ?? "";
  // Guests can't connect apps, so they have none.
  const connected = user.isGuest ? [] : await listConnectedApps(prisma, user.id);
  return (
    <IntegrationsView
      serverUrl={`${origin}${MCP_PATH}`}
      guest={user.isGuest}
      connected={connected.map((app) => ({
        id: app.id,
        name: app.clientName,
        address: app.clientAddress,
        connectedAt: app.createdAt.toISOString(),
        lastUsedAt: app.lastUsedAt?.toISOString() ?? null,
      }))}
    />
  );
}
