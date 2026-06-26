import { prisma } from "@/lib/prisma";
import { projectAccessWhereForProject } from "@/lib/project-access";

export async function markProjectOpened(projectId: string, userId: string) {
  const project = await prisma.project.findFirst({
    where: projectAccessWhereForProject(projectId, userId),
    select: { id: true },
  });
  if (!project) return false;

  await prisma.recentShortcut.upsert({
    where: { userId },
    create: { userId, projectId, projectOpenedAt: new Date() },
    update: { projectId, projectOpenedAt: new Date() },
  });
  return true;
}

export async function markNoteOpened(noteId: string, userId: string) {
  const note = await prisma.note.findFirst({
    where: {
      id: noteId,
      deletedAt: null,
      OR: [{ userId }, { project: { OR: [{ userId }, { members: { some: { userId } } }] } }],
    },
    select: { id: true },
  });
  if (!note) return false;

  await prisma.recentShortcut.upsert({
    where: { userId },
    create: { userId, noteId, noteOpenedAt: new Date() },
    update: { noteId, noteOpenedAt: new Date() },
  });
  return true;
}
