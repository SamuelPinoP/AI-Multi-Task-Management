import "server-only";
import { TaskStatus } from "@prisma/client";
import { normalizeAuthEmail } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { projectAccessWhere } from "@/lib/project-access";

/** How many projects the sidebar lists; the rest are one click away on /projects. */
export const SIDEBAR_PROJECT_LIMIT = 8;

export type WorkspaceNavProject = {
  id: string;
  name: string;
  color: string | null;
  openTasks: number;
};

export type WorkspaceNav = {
  /** Active projects the user owns or is a member of, most recently updated first. */
  projects: WorkspaceNavProject[];
  activeProjectCount: number;
  /** Open (not done, not trashed) tasks on the Tasks page: the user's own plus shared project tasks. */
  openTasks: number;
  pendingInvitations: number;
};

/** Counts and project links for the app shell's sidebar, top bar and bottom tabs. */
export async function getWorkspaceNav(user: { id: string; email: string }): Promise<WorkspaceNav> {
  const activeProjectsWhere = { AND: [projectAccessWhere(user.id), { status: "ACTIVE" as const }] };
  const openTaskWhere = { deletedAt: null, status: { not: TaskStatus.DONE } };

  const [projects, activeProjectCount, openTasks, pendingInvitations] = await Promise.all([
    prisma.project.findMany({
      where: activeProjectsWhere,
      select: {
        id: true,
        name: true,
        color: true,
        _count: { select: { tasks: { where: openTaskWhere } } },
      },
      orderBy: { updatedAt: "desc" },
      take: SIDEBAR_PROJECT_LIMIT,
    }),
    prisma.project.count({ where: activeProjectsWhere }),
    prisma.task.count({
      where: { ...openTaskWhere, OR: [{ userId: user.id }, { project: projectAccessWhere(user.id) }] },
    }),
    prisma.projectInvitation.count({
      where: {
        status: "PENDING",
        OR: [{ invitedUserId: user.id }, { invitedEmail: normalizeAuthEmail(user.email) }],
      },
    }),
  ]);

  return {
    projects: projects.map(({ _count, ...project }) => ({ ...project, openTasks: _count.tasks })),
    activeProjectCount,
    openTasks,
    pendingInvitations,
  };
}
