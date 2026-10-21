import type { Prisma } from "@prisma/client";
import { projectAccessWhere } from "@/lib/project-access";

/** Notes the user can see: their own, and notes in projects they belong to (same as /api/notes). */
export function visibleNoteWhere(userId: string) {
  return { deletedAt: null, OR: [{ userId }, { project: projectAccessWhere(userId) }] } satisfies Prisma.NoteWhereInput;
}

/** Events the user can see: their own, and events in projects they belong to. */
export function visibleEventWhere(userId: string) {
  return { deletedAt: null, OR: [{ userId }, { project: projectAccessWhere(userId) }] } satisfies Prisma.EventWhereInput;
}
