import { Prisma, type Project, type ProjectMemberRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type ProjectAccessLevel = "OWNER" | "EDITOR" | "VIEWER";

export type ProjectAccess = {
  projectId: string;
  userId: string;
  accessLevel: ProjectAccessLevel;
  memberRole: ProjectMemberRole | null;
};

export const PROJECT_ROLE_LABELS: Record<ProjectMemberRole, string> = {
  OWNER: "Owner",
  EDITOR: "Editor",
  VIEWER: "Viewer",
};

export function projectAccessWhere(userId: string): Prisma.ProjectWhereInput {
  return { OR: [{ userId }, { members: { some: { userId } } }] };
}

export function projectAccessWhereForProject(projectId: string, userId: string): Prisma.ProjectWhereInput {
  return { id: projectId, ...projectAccessWhere(userId) };
}

export function getProjectAccessForUser(project: Pick<Project, "id" | "userId"> & { members?: { userId: string | null; role: ProjectMemberRole }[] }, userId: string): ProjectAccess | null {
  if (project.userId === userId) return { projectId: project.id, userId, accessLevel: "OWNER", memberRole: "OWNER" };
  const membership = project.members?.find((member) => member.userId === userId);
  if (!membership) return null;
  return { projectId: project.id, userId, accessLevel: membership.role === "VIEWER" ? "VIEWER" : "EDITOR", memberRole: membership.role };
}

export async function getProjectAccess(projectId: string, userId: string): Promise<ProjectAccess | null> {
  const project = await prisma.project.findFirst({
    where: projectAccessWhereForProject(projectId, userId),
    select: { id: true, userId: true, members: { where: { userId }, select: { userId: true, role: true } } },
  });
  return project ? getProjectAccessForUser(project, userId) : null;
}

export async function getOwnedProject(projectId: string, userId: string) {
  return prisma.project.findFirst({ where: { id: projectId, userId }, select: { id: true, name: true, userId: true } });
}

export function isProjectOwner(access: ProjectAccess | null): access is ProjectAccess & { accessLevel: "OWNER" } {
  return access?.accessLevel === "OWNER";
}

export function canEditProjectContent(access: ProjectAccess | null) {
  return access?.accessLevel === "OWNER" || access?.accessLevel === "EDITOR";
}

export function unauthorizedProjectResponse(action = "perform this action") {
  return { error: `You do not have permission to ${action} on this project.` };
}
