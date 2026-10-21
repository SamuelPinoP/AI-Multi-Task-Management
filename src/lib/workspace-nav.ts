import "server-only";
import { TaskStatus } from "@prisma/client";
import { normalizeAuthEmail } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { projectAccessWhere } from "@/lib/project-access";

/** How many projects the sidebar lists; the rest are one click away on /projects. */
export const SIDEBAR_PROJECT_LIMIT = 8;

/** Chat messages older than this never mark a project chat as new in the sidebar. */
const RECENT_CHAT_DAYS = 14;

export type WorkspaceNavProject = {
  id: string;
  name: string;
  color: string | null;
  openTasks: number;
  /** When someone else last posted in the project chat (ISO) in the last two weeks, for the sidebar's "new" marker. */
  lastChatAt: string | null;
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
  const recentChatSince = new Date(Date.now() - RECENT_CHAT_DAYS * 24 * 60 * 60 * 1000);

  const [projects, activeProjectCount, openTasks, pendingInvitations] = await Promise.all([
    prisma.project.findMany({
      where: activeProjectsWhere,
      select: {
        id: true,
        name: true,
        color: true,
        _count: { select: { tasks: { where: openTaskWhere } } },
        comments: {
          where: { userId: { not: user.id }, createdAt: { gte: recentChatSince } },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { createdAt: true },
        },
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
    projects: projects.map(({ _count, comments, ...project }) => ({
      ...project,
      openTasks: _count.tasks,
      lastChatAt: comments[0]?.createdAt.toISOString() ?? null,
    })),
    activeProjectCount,
    openTasks,
    pendingInvitations,
  };
}
