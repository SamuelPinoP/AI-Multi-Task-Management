import type { Project, ProjectMemberRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { projectAccessWhereForProject } from "@/lib/project-access-core";
import { canManageMembers, memberRole, type ProjectRole } from "@/lib/project-roles";

// The filters live in project-access-core.ts, free of server-only imports; every importer keeps using them from here.
export { projectAccessWhere, projectAccessWhereForProject, projectEditWhere } from "@/lib/project-access-core";

/** OWNER: the project's creator. ADMIN: also manages people. EDITOR: every other member. The rules are in project-roles.ts (#385). */
export type ProjectAccessLevel = ProjectRole;

export type ProjectAccess = {
  projectId: string;
  userId: string;
  accessLevel: ProjectAccessLevel;
  memberRole: ProjectMemberRole | null;
};

export function getProjectAccessForUser(project: Pick<Project, "id" | "userId"> & { members?: { userId: string | null; role: ProjectMemberRole }[] }, userId: string): ProjectAccess | null {
  if (project.userId === userId) return { projectId: project.id, userId, accessLevel: "OWNER", memberRole: "OWNER" };
  const membership = project.members?.find((member) => member.userId === userId);
  if (!membership) return null;
  return { projectId: project.id, userId, accessLevel: memberRole(membership.role), memberRole: membership.role };
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

/** Every member edits the project's content: the owner, admins and editors (#385). */
export function canEditProjectContent(access: ProjectAccess | null): access is ProjectAccess {
  return access !== null;
}

/** The owner and admins invite people, add and remove members, and make admins (#385). */
export function canManageProjectMembers(access: ProjectAccess | null): access is ProjectAccess & { accessLevel: "OWNER" | "ADMIN" } {
  return canManageMembers(access?.accessLevel);
}

export function unauthorizedProjectResponse(action = "perform this action") {
  return { error: `You do not have permission to ${action} on this project.` };
}
