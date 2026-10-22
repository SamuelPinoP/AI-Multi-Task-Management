import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { projectAccessWhere } from "@/lib/project-access";

/**
 * Unread project chat messages (SIDE-03). `ProjectChatRead` keeps when each
 * user last read each chat; a message from someone else after that is unread.
 * Without a record, only messages from the last two weeks count, so an old,
 * busy project doesn't show hundreds the first time.
 *
 * Times are compared in SQL: Prisma stores UTC in `timestamp without time
 * zone` columns, so "now" is `now() AT TIME ZONE 'utc'`, never a Date parameter.
 */
export const UNREAD_CHAT_WINDOW_DAYS = 14;

/** The projects whose chats count: every project the user can open, except archived ones. */
export function chatProjectsWhere(userId: string) {
  return { AND: [projectAccessWhere(userId), { status: { not: "ARCHIVED" as const } }] };
}

/** Unread messages per project, for the projects given; projects with none are left out. */
export async function getChatUnreadCounts(userId: string, projectIds: string[]): Promise<Map<string, number>> {
  if (projectIds.length === 0) return new Map();
  const rows = await prisma.$queryRaw<Array<{ projectId: string; unread: number }>>`
    SELECT c."projectId", COUNT(*)::int AS unread
    FROM "ProjectComment" c
    LEFT JOIN "ProjectChatRead" r ON r."projectId" = c."projectId" AND r."userId" = ${userId}
    WHERE c."projectId" IN (${Prisma.join(projectIds)})
      AND c."userId" <> ${userId}
      AND c."createdAt" > COALESCE(r."lastReadAt", (now() AT TIME ZONE 'utc') - make_interval(days => ${UNREAD_CHAT_WINDOW_DAYS}))
    GROUP BY c."projectId"`;
  return new Map(rows.map((row) => [row.projectId, row.unread]));
}

/** When the user last read a project's chat, or null if never. */
export async function getChatLastRead(userId: string, projectId: string) {
  const read = await prisma.projectChatRead.findUnique({
    where: { userId_projectId: { userId, projectId } },
    select: { lastReadAt: true },
  });
  return read?.lastReadAt ?? null;
}

/** Marks these projects' chats as read up to now. Never moves a mark back. */
export async function markChatsRead(userId: string, projectIds: string[]) {
  if (projectIds.length === 0) return;
  await prisma.$executeRaw`
    INSERT INTO "ProjectChatRead" ("userId", "projectId", "lastReadAt")
    SELECT ${userId}, p."id", now() AT TIME ZONE 'utc'
    FROM "Project" p
    WHERE p."id" IN (${Prisma.join(projectIds)})
    ON CONFLICT ("userId", "projectId")
    DO UPDATE SET "lastReadAt" = GREATEST("ProjectChatRead"."lastReadAt", EXCLUDED."lastReadAt")`;
}
