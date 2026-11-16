// Who can see which projects, as Prisma filters (#385): the pure part of
// src/lib/project-access.ts, which re-exports it. No server-only imports, so
// code that only needs the filters (task-include.ts, note-access.ts and the AI
// assistant's tools, #307) can be unit tested without a database.
import type { Prisma } from "@prisma/client";

export function projectAccessWhere(userId: string): Prisma.ProjectWhereInput {
  return { OR: [{ userId }, { members: { some: { userId } } }] };
}

/** Projects where the user can add, edit and delete content: every member edits (#385). */
export function projectEditWhere(userId: string): Prisma.ProjectWhereInput {
  return projectAccessWhere(userId);
}

export function projectAccessWhereForProject(projectId: string, userId: string): Prisma.ProjectWhereInput {
  return { id: projectId, ...projectAccessWhere(userId) };
}
