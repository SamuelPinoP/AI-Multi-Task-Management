import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { isMcpEnabled } from "@/lib/mcp/connect";
import { disconnectApp } from "@/lib/mcp/oauth-store";
import { prisma } from "@/lib/prisma";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Disconnect, in Connected apps on the Integrations page (#477): revokes the app's grant, so its
 * tool calls stop at once and its refresh tokens stop working.
 */
export async function DELETE(_request: Request, context: RouteContext) {
  if (!isMcpEnabled(process.env)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const { id } = await context.params;
  const disconnected = await disconnectApp(prisma, user.id, id, new Date());
  if (!disconnected) return NextResponse.json({ error: "That app isn't connected." }, { status: 404 });
  return NextResponse.json({ disconnected: true });
}
