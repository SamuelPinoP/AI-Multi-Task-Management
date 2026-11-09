import "server-only";
import { Prisma } from "@prisma/client";
import { formatChatTime, type DirectChatSummary } from "@/lib/chats";
import { directChatPair, displayName, teammatesFrom, type Teammate } from "@/lib/direct-chats-core";
import { prisma } from "@/lib/prisma";
import { projectAccessWhere } from "@/lib/project-access";
import { UNREAD_CHAT_WINDOW_DAYS } from "@/lib/project-chat-unread";
import { getUserTimeZone } from "@/lib/user-time-server";

/**
 * Direct messages (#387): one-to-one chats between people who share a project.
 * The API is keyed by the other person's user id, so a chat needs no id until
 * its first message creates it. Times are compared in SQL, as for project
 * chats: Prisma stores UTC in `timestamp without time zone` columns.
 */

/** The longest message, like a task comment's. */
export const DIRECT_MESSAGE_MAX = 5000;

export const NO_LONGER_SHARED_ERROR = "You no longer share a project with this person, so you can't send new messages.";

const PERSON_SELECT = { id: true, name: true, email: true } as const;

export const DIRECT_MESSAGE_SELECT = {
  id: true,
  message: true,
  pinned: true,
  createdAt: true,
  updatedAt: true,
  user: { select: { name: true, email: true } },
} as const satisfies Prisma.DirectMessageSelect;

type DirectMessageRow = Prisma.DirectMessageGetPayload<{ select: typeof DIRECT_MESSAGE_SELECT }>;

/** A message in the project chat's shape, so the chat view shows both kinds. Direct messages have no files. */
export function serializeDirectMessage(message: DirectMessageRow) {
  return {
    id: message.id,
    message: message.message,
    pinned: message.pinned,
    createdAt: message.createdAt.toISOString(),
    updatedAt: message.updatedAt.toISOString(),
    author: { name: message.user.name, email: message.user.email },
    attachments: [],
  };
}

/** Everyone the user shares a project with (owners and members with an account), archived projects included. */
export async function getTeammates(userId: string): Promise<Teammate[]> {
  const projects = await prisma.project.findMany({
    where: projectAccessWhere(userId),
    orderBy: { updatedAt: "desc" },
    select: {
      name: true,
      user: { select: PERSON_SELECT },
      members: { where: { userId: { not: null } }, select: { user: { select: PERSON_SELECT } } },
    },
  });
  return teammatesFrom(
    projects.map((project) => ({
      name: project.name,
      people: [project.user, ...project.members.flatMap((member) => (member.user ? [member.user] : []))],
    })),
    userId,
  );
}

/** The projects two people are both in, by name. */
export async function sharedProjects(userId: string, otherId: string) {
  if (userId === otherId) return [];
  const projects = await prisma.project.findMany({
    where: { AND: [projectAccessWhere(userId), projectAccessWhere(otherId)] },
    orderBy: { updatedAt: "desc" },
    select: { name: true },
  });
  return projects.map((project) => project.name);
}

/**
 * What the user may do in a direct chat with `otherId`: read it when it
 * exists or when they share a project, and send only while they share one.
 * Null means neither, and to the user the chat isn't there (404).
 */
export async function directChatAccess(userId: string, otherId: string) {
  if (!otherId || userId === otherId) return null;
  const [chat, projects] = await Promise.all([
    prisma.directChat.findUnique({ where: { userAId_userBId: directChatPair(userId, otherId) }, select: { id: true } }),
    sharedProjects(userId, otherId),
  ]);
  if (!chat && projects.length === 0) return null;
  return { chatId: chat?.id ?? null, canSend: projects.length > 0, projects };
}

/** The chat between two people, made on their first message. Safe when both write at once. */
export async function ensureDirectChat(userId: string, otherId: string) {
  const pair = directChatPair(userId, otherId);
  try {
    return (await prisma.directChat.upsert({ where: { userAId_userBId: pair }, update: {}, create: pair, select: { id: true } })).id;
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    return (await prisma.directChat.findUniqueOrThrow({ where: { userAId_userBId: pair }, select: { id: true } })).id;
  }
}

/** Sums up a chat's messages: their count, latest edit and pins. The open chat polls it, like a project chat's. */
export async function directChatVersion(chatId: string | null) {
  if (!chatId) return "0:0:0";
  const [summary, pinned] = await Promise.all([
    prisma.directMessage.aggregate({ where: { chatId }, _count: { _all: true }, _max: { updatedAt: true } }),
    prisma.directMessage.count({ where: { chatId, pinned: true } }),
  ]);
  return `${summary._count._all}:${summary._max.updatedAt?.getTime() ?? 0}:${pinned}`;
}

export async function getDirectMessages(chatId: string | null) {
  if (!chatId) return [];
  const messages = await prisma.directMessage.findMany({ where: { chatId }, orderBy: { createdAt: "asc" }, select: DIRECT_MESSAGE_SELECT });
  return messages.map(serializeDirectMessage);
}

/** Messages from the other person since the user last read each chat (two weeks without a read mark); chats with none are left out. */
export async function getDirectUnreadCounts(userId: string): Promise<Map<string, number>> {
  const rows = await prisma.$queryRaw<Array<{ chatId: string; unread: number }>>`
    SELECT m."chatId", COUNT(*)::int AS unread
    FROM "DirectMessage" m
    JOIN "DirectChat" c ON c."id" = m."chatId"
    LEFT JOIN "DirectChatRead" r ON r."chatId" = m."chatId" AND r."userId" = ${userId}
    WHERE (c."userAId" = ${userId} OR c."userBId" = ${userId})
      AND m."userId" <> ${userId}
      AND m."createdAt" > COALESCE(r."lastReadAt", (now() AT TIME ZONE 'utc') - make_interval(days => ${UNREAD_CHAT_WINDOW_DAYS}))
    GROUP BY m."chatId"`;
  return new Map(rows.map((row) => [row.chatId, row.unread]));
}

/** Marks these direct chats as read up to now. Never moves a mark back. */
export async function markDirectChatsRead(userId: string, chatIds: string[]) {
  if (chatIds.length === 0) return;
  await prisma.$executeRaw`
    INSERT INTO "DirectChatRead" ("userId", "chatId", "lastReadAt")
    SELECT ${userId}, c."id", now() AT TIME ZONE 'utc'
    FROM "DirectChat" c
    WHERE c."id" IN (${Prisma.join(chatIds)}) AND (c."userAId" = ${userId} OR c."userBId" = ${userId})
    ON CONFLICT ("userId", "chatId")
    DO UPDATE SET "lastReadAt" = GREATEST("DirectChatRead"."lastReadAt", EXCLUDED."lastReadAt")`;
}

/** Every direct chat the user is in, for Mark all read. */
export async function getDirectChatIds(userId: string) {
  const chats = await prisma.directChat.findMany({ where: { OR: [{ userAId: userId }, { userBId: userId }] }, select: { id: true } });
  return chats.map((chat) => chat.id);
}

/** The user's direct chats that have messages, for the Chats list; `teammates` says who the user still shares projects with. */
export async function getDirectChatSummaries(user: { id: string }, teammates: Teammate[]): Promise<DirectChatSummary[]> {
  const [chats, unread, timeZone] = await Promise.all([
    prisma.directChat.findMany({
      where: { OR: [{ userAId: user.id }, { userBId: user.id }], messages: { some: {} } },
      select: {
        id: true,
        userA: { select: PERSON_SELECT },
        userB: { select: PERSON_SELECT },
        messages: { orderBy: { createdAt: "desc" }, take: 1, select: { message: true, createdAt: true, userId: true } },
      },
    }),
    getDirectUnreadCounts(user.id),
    getUserTimeZone(),
  ]);
  const shared = new Map(teammates.map((teammate) => [teammate.id, teammate.projects]));
  const now = new Date();

  return chats.flatMap((chat) => {
    const other = chat.userA.id === user.id ? chat.userB : chat.userA;
    const last = chat.messages[0];
    if (!last) return [];
    const name = displayName(other);
    return [
      {
        personId: other.id,
        name,
        unread: unread.get(chat.id) ?? 0,
        projects: shared.get(other.id) ?? [],
        lastMessage: {
          author: last.userId === user.id ? "You" : name.split(" ")[0],
          text: last.message.replace(/\s+/g, " ").trim().slice(0, 160),
          attachmentCount: 0,
          at: last.createdAt.toISOString(),
          timeLabel: formatChatTime(last.createdAt, now, timeZone),
        },
      },
    ];
  });
}

export type OpenedDirectChat = NonNullable<Awaited<ReturnType<typeof openDirectChat>>>;

/**
 * Loads a direct chat with `personId` for the Chats page and marks it read.
 * Null when the user may not see one (no chat and no shared project).
 */
export async function openDirectChat(personId: string, user: { id: string }) {
  const access = await directChatAccess(user.id, personId);
  if (!access) return null;
  const person = await prisma.user.findUnique({ where: { id: personId }, select: PERSON_SELECT });
  if (!person) return null;

  const previousRead = access.chatId
    ? (await prisma.directChatRead.findUnique({ where: { userId_chatId: { userId: user.id, chatId: access.chatId } }, select: { lastReadAt: true } }))?.lastReadAt ?? null
    : null;
  const initialComments = await getDirectMessages(access.chatId);
  if (access.chatId) await markDirectChatsRead(user.id, [access.chatId]);
  const newSince = previousRead ?? new Date(Date.now() - UNREAD_CHAT_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  return {
    personId: person.id,
    name: displayName(person),
    projects: access.projects,
    canSend: access.canSend,
    newSince: newSince.toISOString(),
    initialComments,
  };
}
