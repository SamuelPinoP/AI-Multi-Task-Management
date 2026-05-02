import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

const DEMO_USER_EMAIL = "samuel@example.com";

export async function GET() {
  const user = await prisma.user.findUnique({ where: { email: DEMO_USER_EMAIL }, select: { id: true } });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const [notes, tasks, events] = await Promise.all([
    prisma.note.findMany({ where: { userId: user.id, deletedAt: { not: null } }, orderBy: { deletedAt: "desc" } }),
    prisma.task.findMany({ where: { userId: user.id, deletedAt: { not: null } }, orderBy: { deletedAt: "desc" } }),
    prisma.event.findMany({ where: { userId: user.id, deletedAt: { not: null } }, orderBy: { deletedAt: "desc" } }),
  ]);

  return NextResponse.json({ notes, tasks, events });
}

export async function PATCH(req: Request) {
  const body = await req.json();
  const type = body.type as "note" | "task" | "event";
  const id = typeof body.id === "string" ? body.id : "";

  if (!id || !type) return NextResponse.json({ error: "Type and id are required" }, { status: 400 });

  const where = { id, deletedAt: { not: null }, user: { email: DEMO_USER_EMAIL } };

  const updated =
    type === "note"
      ? await prisma.note.updateMany({ where, data: { deletedAt: null } })
      : type === "task"
      ? await prisma.task.updateMany({ where, data: { deletedAt: null } })
      : await prisma.event.updateMany({ where, data: { deletedAt: null } });

  if (updated.count === 0) return NextResponse.json({ error: "Item not found" }, { status: 404 });

  return NextResponse.json({ message: "Item restored" }, { status: 200 });
}
