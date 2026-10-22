import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/lib/auth";
import { NextResponse } from "next/server";
import { createActivity } from "@/lib/activity";
import { projectEditWhere } from "@/lib/project-access";

const TRASH_TYPES = ["note", "task", "event"] as const;
type TrashType = (typeof TRASH_TYPES)[number];

/**
 * Trashed items you own, plus anything trashed in a project you can edit, so
 * a teammate who deleted your task can put it back (BUG-12).
 */
function trashWhere(userId: string) {
  return { deletedAt: { not: null }, OR: [{ userId }, { project: projectEditWhere(userId) }] };
}

const trashSelect = {
  id: true,
  title: true,
  deletedAt: true,
  deletedById: true,
  userId: true,
  project: { select: { name: true } },
} as const;

export async function GET() {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const where = trashWhere(user.id);
  const [notes, tasks, events] = await Promise.all([
    prisma.note.findMany({ where, select: trashSelect, orderBy: { deletedAt: "desc" } }),
    prisma.task.findMany({ where, select: trashSelect, orderBy: { deletedAt: "desc" } }),
    prisma.event.findMany({ where, select: trashSelect, orderBy: { deletedAt: "desc" } }),
  ]);

  // Name whoever deleted each item, unless it was you.
  const deleterIds = [...new Set([...notes, ...tasks, ...events].map((item) => item.deletedById))].filter(
    (id): id is string => Boolean(id) && id !== user.id,
  );
  const deleters = deleterIds.length
    ? await prisma.user.findMany({ where: { id: { in: deleterIds } }, select: { id: true, name: true, email: true } })
    : [];
  const deleterNames = new Map(deleters.map((deleter) => [deleter.id, deleter.name || deleter.email]));

  const serialize = (item: (typeof notes)[number]) => ({
    id: item.id,
    title: item.title,
    deletedAt: item.deletedAt,
    projectName: item.project?.name ?? null,
    deletedByName: item.deletedById ? (deleterNames.get(item.deletedById) ?? null) : null,
    ownedByYou: item.userId === user.id,
  });

  return NextResponse.json({ notes: notes.map(serialize), tasks: tasks.map(serialize), events: events.map(serialize) });
}

export async function PATCH(req: Request) {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { type?: unknown; id?: unknown } | null;
  const type = TRASH_TYPES.find((value) => value === body?.type);
  const id = typeof body?.id === "string" ? body.id : "";

  if (!id || !type) return NextResponse.json({ error: "Type (note, task or event) and id are required" }, { status: 400 });

  const where = { id, ...trashWhere(user.id) };
  const data = { deletedAt: null, deletedById: null };
  const select = { id: true, title: true, projectId: true } as const;

  const item =
    type === "note"
      ? await prisma.note.findFirst({ where, select })
      : type === "task"
      ? await prisma.task.findFirst({ where, select })
      : await prisma.event.findFirst({ where, select });

  const updated =
    type === "note"
      ? await prisma.note.updateMany({ where, data })
      : type === "task"
      ? await prisma.task.updateMany({ where, data })
      : await prisma.event.updateMany({ where, data });

  if (updated.count === 0 || !item) return NextResponse.json({ error: "Item not found" }, { status: 404 });

  void createActivity({
    userId: user.id,
    action: "RESTORED_ITEM",
    message: `Restored ${type}: “${item.title}”`,
    entityType: type.toUpperCase() as Uppercase<TrashType>,
    entityId: item.id,
    projectId: item.projectId,
  });

  return NextResponse.json({ message: "Item restored" }, { status: 200 });
}


// Emptying only removes items you own; teammates' items stay in their trash.
export async function DELETE() {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const [notes, tasks, events] = await Promise.all([
    prisma.note.deleteMany({ where: { userId: user.id, deletedAt: { not: null } } }),
    prisma.task.deleteMany({ where: { userId: user.id, deletedAt: { not: null } } }),
    prisma.event.deleteMany({ where: { userId: user.id, deletedAt: { not: null } } }),
  ]);

  return NextResponse.json({
    message: "Trash emptied",
    deleted: { notes: notes.count, tasks: tasks.count, events: events.count },
  }, { status: 200 });
}
