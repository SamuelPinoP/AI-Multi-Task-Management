import "server-only";
import { formatChatTime, sortChatSummaries, teammateCount, type ChatAccessLevel, type ChatSummary } from "@/lib/chats";
import { prisma } from "@/lib/prisma";
import { getProjectAccessForUser, projectAccessWhereForProject } from "@/lib/project-access";
import {
  chatProjectsWhere,
  getChatLastRead,
  getChatUnreadCounts,
  markChatsRead,
  UNREAD_CHAT_WINDOW_DAYS,
} from "@/lib/project-chat-unread";
import { PROJECT_CHAT_GUEST_UPLOADS_MESSAGE, projectChatGuestUploadsEnabled } from "@/lib/project-chat-quota";
import { getUserTimeZone } from "@/lib/user-time-server";

type ChatUser = { id: string; name: string | null; email: string; isGuest: boolean };

/** The owner plus everyone else on the team (members without an account included). */
function peopleCount(project: { userId: string; members: { userId: string | null }[] }) {
  return 1 + project.members.filter((member) => member.userId !== project.userId).length;
}

function firstName(user: { name: string | null; email: string }) {
  return (user.name || user.email).trim().split(/[\s@]/)[0] || user.email;
}

/** One row per project chat, sorted for the Chats hub. */
export async function getChatSummaries(user: ChatUser): Promise<ChatSummary[]> {
  const [projects, timeZone] = await Promise.all([
    prisma.project.findMany({
      where: chatProjectsWhere(user.id),
      select: {
        id: true,
        name: true,
        color: true,
        userId: true,
        members: { select: { userId: true, role: true } },
        comments: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            message: true,
            createdAt: true,
            userId: true,
            user: { select: { name: true, email: true } },
            _count: { select: { attachments: true } },
          },
        },
      },
    }),
    getUserTimeZone(),
  ]);
  const unread = await getChatUnreadCounts(user.id, projects.map((project) => project.id));
  const now = new Date();

  return sortChatSummaries(
    projects.map((project) => {
      const last = project.comments[0];
      return {
        projectId: project.id,
        name: project.name,
        color: project.color,
        accessLevel: getProjectAccessForUser(project, user.id)?.accessLevel ?? "VIEWER",
        memberCount: peopleCount(project),
        unread: unread.get(project.id) ?? 0,
        teammates: teammateCount(project, user.id),
        lastMessage: last
          ? {
              author: last.userId === user.id ? "You" : firstName(last.user),
              text: last.message.replace(/\s+/g, " ").trim().slice(0, 160),
              attachmentCount: last._count.attachments,
              at: last.createdAt.toISOString(),
              timeLabel: formatChatTime(last.createdAt, now, timeZone),
            }
          : null,
      };
    }),
  );
}

export type OpenedProjectChat = NonNullable<Awaited<ReturnType<typeof openProjectChat>>>;

/**
 * Loads a project's chat for a page that shows it, and marks it read.
 * `newSince` is the previous read mark (or the start of the unread window),
 * so the chat can show where the new messages begin.
 */
export async function openProjectChat(projectId: string, user: ChatUser) {
  const project = await prisma.project.findFirst({
    where: projectAccessWhereForProject(projectId, user.id),
    select: {
      id: true,
      name: true,
      color: true,
      userId: true,
      members: { select: { userId: true, role: true } },
      comments: {
        orderBy: { createdAt: "asc" },
        include: { user: { select: { name: true, email: true } }, attachments: { orderBy: { createdAt: "asc" } } },
      },
    },
  });
  if (!project) return null;

  const accessLevel: ChatAccessLevel = getProjectAccessForUser(project, user.id)?.accessLevel ?? "VIEWER";
  const previousRead = await getChatLastRead(user.id, project.id);
  await markChatsRead(user.id, [project.id]);
  const newSince = previousRead ?? new Date(Date.now() - UNREAD_CHAT_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  return {
    id: project.id,
    name: project.name,
    color: project.color,
    accessLevel,
    memberCount: peopleCount(project),
    readOnly: accessLevel === "VIEWER",
    attachmentsDisabledMessage:
      user.isGuest && !projectChatGuestUploadsEnabled() ? PROJECT_CHAT_GUEST_UPLOADS_MESSAGE : undefined,
    newSince: newSince.toISOString(),
    initialComments: project.comments.map((comment) => ({
      id: comment.id,
      message: comment.message,
      pinned: comment.pinned,
      createdAt: comment.createdAt.toISOString(),
      updatedAt: comment.updatedAt.toISOString(),
      author: { name: comment.user.name, email: comment.user.email },
      attachments: comment.attachments.map((attachment) => ({
        id: attachment.id,
        fileName: attachment.fileName,
        originalName: attachment.originalName,
        fileType: attachment.fileType,
        fileSize: attachment.fileSize,
        url: attachment.url,
        createdAt: attachment.createdAt.toISOString(),
      })),
    })),
  };
}
