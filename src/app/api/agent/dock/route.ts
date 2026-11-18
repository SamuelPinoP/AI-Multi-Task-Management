import { NextResponse } from "next/server";
import { aiDockRequestSchema, aiDockToStored } from "@/lib/ai/dock";
import { requireApiUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * Saves where the AI bar shows on the person's pages (#308): `{ dock: "open" | "minimized" | "hidden" }`.
 * Per account, so it's the same on every device; the root layout reads it with the session.
 */
export async function PUT(request: Request) {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (user.isGuest) return NextResponse.json({ error: "Create an account to use the AI assistant." }, { status: 403 });

  const parsed = aiDockRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Send { dock: "open" | "minimized" | "hidden" }.' }, { status: 400 });

  await prisma.user.update({ where: { id: user.id }, data: { aiDock: aiDockToStored(parsed.data.dock) } });
  return NextResponse.json({ dock: parsed.data.dock });
}
