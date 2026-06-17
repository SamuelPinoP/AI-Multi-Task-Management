import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizeAuthEmail } from "@/lib/auth";
import { projectAccessWhere } from "@/lib/project-access";

export type NotificationKind =
  | "TASK_DUE_SOON"
  | "TASK_OVERDUE"
  | "EVENT_COMING_SOON"
  | "PROJECT_INVITATION"
  | "PROJECT_INVITATION_RESPONSE"
  | "PROJECT_CHAT_ACTIVITY"
  | "PLANNER_REMINDER";

export type AppNotification = {
  id: string;
  sourceKey: string;
  kind: NotificationKind;
  title: string;
  body: string;
  href: string;
  createdAt: Date;
  readAt: Date | null;
  dismissedAt: Date | null;
  projectId?: string | null;
};

const TASK_SOON_DAYS = 3;
const EVENT_SOON_DAYS = 7;
const CHAT_LOOKBACK_DAYS = 7;
const INVITATION_RESPONSE_LOOKBACK_DAYS = 14;

function daysFromNow(days: number) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function startOfToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function describeDate(value: Date) {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(value);
}

async function getNotificationStates(userId: string, sourceKeys: string[]) {
  if (sourceKeys.length === 0) return new Map<string, { readAt: Date | null; dismissedAt: Date | null }>();
  const states = await prisma.notificationState.findMany({
    where: { userId, sourceKey: { in: sourceKeys } },
    select: { sourceKey: true, readAt: true, dismissedAt: true },
  });
  return new Map(states.map((state) => [state.sourceKey, { readAt: state.readAt, dismissedAt: state.dismissedAt }]));
}

export async function buildNotificationsForUser(user: { id: string; email: string }) {
  const now = new Date();
  const today = startOfToday();
  const [tasks, events, invitations, invitationResponses, comments] = await Promise.all([
    prisma.task.findMany({
      where: {
        deletedAt: null,
        status: { not: "DONE" },
        dueDate: { lte: daysFromNow(TASK_SOON_DAYS) },
        OR: [
          { userId: user.id },
          { assignee: { userId: user.id } },
          { project: projectAccessWhere(user.id) },
        ],
      },
      select: { id: true, title: true, dueDate: true, projectId: true, project: { select: { name: true } } },
      orderBy: { dueDate: "asc" },
      take: 50,
    }),
    prisma.event.findMany({
      where: {
        deletedAt: null,
        startTime: { gte: now, lte: daysFromNow(EVENT_SOON_DAYS) },
        OR: [{ userId: user.id }, { project: projectAccessWhere(user.id) }],
      },
      select: { id: true, title: true, startTime: true, projectId: true, project: { select: { name: true } } },
      orderBy: { startTime: "asc" },
      take: 50,
    }),
    prisma.projectInvitation.findMany({
      where: {
        status: "PENDING",
        OR: [{ invitedUserId: user.id }, { invitedEmail: normalizeAuthEmail(user.email) }],
      },
      select: { id: true, createdAt: true, role: true, project: { select: { id: true, name: true } }, inviterUser: { select: { name: true, email: true } } },
      orderBy: { createdAt: "desc" },
      take: 25,
    }),
    prisma.projectInvitation.findMany({
      where: {
        inviterUserId: user.id,
        status: { in: ["ACCEPTED", "DECLINED"] },
        updatedAt: { gte: daysFromNow(-INVITATION_RESPONSE_LOOKBACK_DAYS) },
      },
      select: { id: true, updatedAt: true, status: true, invitedEmail: true, project: { select: { id: true, name: true } } },
      orderBy: { updatedAt: "desc" },
      take: 25,
    }),
    prisma.projectComment.findMany({
      where: {
        userId: { not: user.id },
        createdAt: { gte: daysFromNow(-CHAT_LOOKBACK_DAYS) },
        project: projectAccessWhere(user.id),
      },
      select: { id: true, message: true, createdAt: true, projectId: true, project: { select: { name: true } }, user: { select: { name: true, email: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);

  const notifications: Omit<AppNotification, "readAt" | "dismissedAt">[] = [];
  for (const task of tasks) {
    if (!task.dueDate) continue;
    const overdue = task.dueDate < today;
    notifications.push({
      id: `task:${overdue ? "overdue" : "due-soon"}:${task.id}`,
      sourceKey: `task:${overdue ? "overdue" : "due-soon"}:${task.id}:${task.dueDate.toISOString()}`,
      kind: overdue ? "TASK_OVERDUE" : "TASK_DUE_SOON",
      title: overdue ? "Task overdue" : "Task due soon",
      body: `${task.title} ${overdue ? "was due" : "is due"} ${describeDate(task.dueDate)}${task.project?.name ? ` in ${task.project.name}` : ""}.`,
      href: `/tasks?highlight=${task.id}`,
      createdAt: task.dueDate,
      projectId: task.projectId,
    });
  }
  for (const event of events) notifications.push({ id: `event:${event.id}`, sourceKey: `event:soon:${event.id}:${event.startTime.toISOString()}`, kind: "EVENT_COMING_SOON", title: "Event coming soon", body: `${event.title} starts ${describeDate(event.startTime)}${event.project?.name ? ` in ${event.project.name}` : ""}.`, href: `/events?highlight=${event.id}`, createdAt: event.startTime, projectId: event.projectId });
  for (const invite of invitations) notifications.push({ id: `invitation:${invite.id}`, sourceKey: `invitation:pending:${invite.id}`, kind: "PROJECT_INVITATION", title: "Project invitation", body: `${invite.inviterUser.name || invite.inviterUser.email} invited you to ${invite.project.name} as ${invite.role.toLowerCase()}.`, href: "/projects", createdAt: invite.createdAt, projectId: invite.project.id });
  for (const invite of invitationResponses) notifications.push({ id: `invitation-response:${invite.id}`, sourceKey: `invitation:response:${invite.id}:${invite.status}`, kind: "PROJECT_INVITATION_RESPONSE", title: `Invitation ${invite.status.toLowerCase()}`, body: `${invite.invitedEmail} ${invite.status.toLowerCase()} your invitation to ${invite.project.name}.`, href: `/projects/${invite.project.id}`, createdAt: invite.updatedAt, projectId: invite.project.id });
  for (const comment of comments) notifications.push({ id: `comment:${comment.id}`, sourceKey: `comment:${comment.id}`, kind: "PROJECT_CHAT_ACTIVITY", title: "Project chat activity", body: `${comment.user.name || comment.user.email} posted in ${comment.project.name}: ${comment.message || "Shared files"}`, href: `/projects/${comment.projectId}/chat`, createdAt: comment.createdAt, projectId: comment.projectId });
  if (tasks.length || events.length) notifications.push({ id: "planner:today", sourceKey: `planner:today:${today.toISOString()}`, kind: "PLANNER_REMINDER", title: "Review your daily plan", body: "You have upcoming work. Open the Smart Daily Planner to balance priorities and schedule focus time.", href: "/planner", createdAt: today, projectId: null });

  const stateMap = await getNotificationStates(user.id, notifications.map((n) => n.sourceKey));
  return notifications
    .map((notification) => ({ ...notification, readAt: stateMap.get(notification.sourceKey)?.readAt ?? null, dismissedAt: stateMap.get(notification.sourceKey)?.dismissedAt ?? null }))
    .filter((notification) => !notification.dismissedAt)
    .sort((a, b) => Number(!b.readAt) - Number(!a.readAt) || b.createdAt.getTime() - a.createdAt.getTime());
}

export async function getUnreadNotificationCount(user: { id: string; email: string }) {
  const notifications = await buildNotificationsForUser(user);
  return notifications.filter((notification) => !notification.readAt).length;
}

export async function setNotificationState(user: { id: string; email: string }, sourceKey: string, data: { read?: boolean; dismiss?: boolean }) {
  const notification = (await buildNotificationsForUser(user)).find((item) => item.sourceKey === sourceKey);
  if (!notification) return null;
  const now = new Date();
  await prisma.notificationState.upsert({
    where: { userId_sourceKey: { userId: user.id, sourceKey } },
    update: { ...(data.read ? { readAt: now } : {}), ...(data.dismiss ? { dismissedAt: now, readAt: now } : {}) },
    create: { userId: user.id, sourceKey, readAt: data.read || data.dismiss ? now : null, dismissedAt: data.dismiss ? now : null },
  });
  return notification;
}

export async function markAllNotificationsRead(user: { id: string; email: string }) {
  const unread = (await buildNotificationsForUser(user)).filter((notification) => !notification.readAt);
  if (unread.length === 0) return 0;
  const now = new Date();
  await prisma.$transaction(unread.map((notification) => prisma.notificationState.upsert({
    where: { userId_sourceKey: { userId: user.id, sourceKey: notification.sourceKey } },
    update: { readAt: now },
    create: { userId: user.id, sourceKey: notification.sourceKey, readAt: now },
  })) as Prisma.PrismaPromise<unknown>[]);
  return unread.length;
}
