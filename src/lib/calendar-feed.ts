import "server-only";
import { randomBytes } from "node:crypto";
import { buildCalendarFeed } from "@/lib/calendar-feed-core";
import { prisma } from "@/lib/prisma";
import { projectAccessWhere } from "@/lib/project-access";
import { visibleTaskWhere } from "@/lib/task-include";

/**
 * Calendar subscription links (SMART-09): /api/calendar/<token>.ics. The token
 * is 24 random bytes (base64url, 32 characters), like project share links.
 */
export function newCalendarFeedToken() {
  return randomBytes(24).toString("base64url");
}

export function calendarFeedPath(token: string) {
  return `/api/calendar/${token}.ics`;
}

/** How far back the feed reaches; calendar apps rarely show more, and it keeps the file small. */
const HISTORY_DAYS = 90;
const MAX_ITEMS = 2000;

/** The user's feed: the events and open due tasks they can see in the app. */
export async function calendarFeedFor(userId: string, appUrl: string) {
  const since = new Date(Date.now() - HISTORY_DAYS * 86_400_000);
  const project = { select: { name: true } } as const;
  const [events, tasks] = await Promise.all([
    prisma.event.findMany({
      where: {
        deletedAt: null,
        AND: [
          { OR: [{ userId }, { project: projectAccessWhere(userId) }] },
          // Recent one-off events, and repeats that haven't ended long ago.
          { OR: [{ startTime: { gte: since } }, { recurrence: { not: "NONE" }, OR: [{ repeatUntil: null }, { repeatUntil: { gte: since } }] }] },
        ],
      },
      orderBy: { startTime: "desc" },
      take: MAX_ITEMS,
      select: {
        id: true,
        title: true,
        description: true,
        location: true,
        startTime: true,
        endTime: true,
        hasStartTime: true,
        hasEndTime: true,
        recurrence: true,
        repeatUntil: true,
        updatedAt: true,
        project,
      },
    }),
    prisma.task.findMany({
      where: { ...visibleTaskWhere(userId), status: { not: "DONE" }, dueDate: { gte: since } },
      orderBy: { dueDate: "desc" },
      take: MAX_ITEMS,
      select: { id: true, title: true, description: true, dueDate: true, updatedAt: true, project },
    }),
  ]);

  return buildCalendarFeed({
    appUrl,
    events: events.map(({ project: eventProject, ...event }) => ({ ...event, projectName: eventProject?.name ?? null })),
    tasks: tasks.flatMap(({ project: taskProject, dueDate, ...task }) =>
      dueDate ? [{ ...task, dueDate, projectName: taskProject?.name ?? null }] : [],
    ),
  });
}
