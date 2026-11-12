import "server-only";
import { prisma } from "@/lib/prisma";
import { projectEditWhere } from "@/lib/project-access";

/**
 * Trashed items you own, plus anything trashed in a project you can edit, so
 * a teammate who deleted your task can put it back (BUG-12).
 */
export function trashWhere(userId: string) {
  return { deletedAt: { not: null }, OR: [{ userId }, { project: projectEditWhere(userId) }] };
}

/** How many notes, tasks and events the Trash page lists; the sidebar shows Trash only when there are some (#404). */
export async function countTrash(userId: string) {
  const where = trashWhere(userId);
  const [notes, tasks, events] = await Promise.all([
    prisma.note.count({ where }),
    prisma.task.count({ where }),
    prisma.event.count({ where }),
  ]);
  return notes + tasks + events;
}
