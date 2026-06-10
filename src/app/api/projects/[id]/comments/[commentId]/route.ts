import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/lib/auth";
import { deleteProjectChatAttachments } from "@/lib/project-chat-storage";
import { projectAccessWhereForProject } from "@/lib/project-access";

type RouteContext = { params: Promise<{ id: string; commentId: string }> };

function serializeComment(comment: {
  id: string;
  message: string;
  pinned: boolean;
  createdAt: Date;
  updatedAt: Date;
  user: { name: string | null; email: string };
  attachments: {
    id: string;
    fileName: string;
    originalName: string;
    fileType: string;
    fileSize: number;
    url: string;
    createdAt: Date;
  }[];
}) {
  return {
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
  };
}

async function getOwnedProjectComment(projectId: string, commentId: string) {
  const user = await requireApiUser();
  if (!user) return { error: NextResponse.json({ error: "Authentication required" }, { status: 401 }) };

  const project = await prisma.project.findFirst({ where: projectAccessWhereForProject(projectId, user.id), select: { id: true } });
  if (!project) return { error: NextResponse.json({ error: "Project not found" }, { status: 404 }) };

  const comment = await prisma.projectComment.findFirst({
    where: { id: commentId, projectId: project.id },
    select: {
      id: true,
      projectId: true,
      userId: true,
      message: true,
      pinned: true,
      updatedAt: true,
      attachments: { select: { fileName: true, url: true } },
      _count: { select: { attachments: true } },
    },
  });

  if (!comment) return { error: NextResponse.json({ error: "Comment not found" }, { status: 404 }) };
  if (comment.userId !== user.id) return { error: NextResponse.json({ error: "You can only change your own messages." }, { status: 403 }) };

  return { user, project, comment };
}

export async function PATCH(req: Request, context: RouteContext) {
  try {
    const { id: projectId, commentId } = await context.params;
    const result = await getOwnedProjectComment(projectId, commentId);
    if ("error" in result) return result.error;

    const body = await req.json().catch(() => ({}));
    const hasMessageUpdate = typeof body.message === "string";
    const hasPinnedUpdate = typeof body.pinned === "boolean";

    if (!hasMessageUpdate && !hasPinnedUpdate) {
      return NextResponse.json({ error: "Message or pinned state is required" }, { status: 400 });
    }

    const message = hasMessageUpdate ? body.message.trim() : result.comment.message;

    if (!message && result.comment._count.attachments === 0) {
      return NextResponse.json({ error: "Edited message cannot be empty unless it has attachments." }, { status: 400 });
    }

    const updatedComment = await prisma.projectComment.update({
      where: { id: result.comment.id },
      data: {
        ...(hasMessageUpdate ? { message } : {}),
        ...(hasPinnedUpdate ? { pinned: body.pinned, ...(!hasMessageUpdate ? { updatedAt: result.comment.updatedAt } : {}) } : {}),
      },
      include: {
        user: { select: { name: true, email: true } },
        attachments: { orderBy: { createdAt: "asc" } },
      },
    });

    return NextResponse.json(serializeComment(updatedComment));
  } catch (error) {
    console.error("PATCH /api/projects/[id]/comments/[commentId] error:", error);
    return NextResponse.json({ error: "Failed to update project comment" }, { status: 500 });
  }
}

export async function DELETE(_req: Request, context: RouteContext) {
  try {
    const { id: projectId, commentId } = await context.params;
    const result = await getOwnedProjectComment(projectId, commentId);
    if ("error" in result) return result.error;

    try {
      await deleteProjectChatAttachments(result.comment.attachments);
    } catch (storageError) {
      console.warn(
        `Could not delete one or more stored attachments for project comment ${result.comment.id}. The comment metadata will still be deleted.`,
        storageError,
      );
    }

    await prisma.projectComment.delete({ where: { id: result.comment.id } });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("DELETE /api/projects/[id]/comments/[commentId] error:", error);
    return NextResponse.json({ error: "Failed to delete project comment" }, { status: 500 });
  }
}
