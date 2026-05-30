import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const DEMO_USER_EMAIL = "samuel@example.com";

type RouteContext = { params: Promise<{ id: string; commentId: string }> };

function serializeComment(comment: {
  id: string;
  message: string;
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
  const user = await prisma.user.findUnique({ where: { email: DEMO_USER_EMAIL }, select: { id: true } });
  if (!user) return { error: NextResponse.json({ error: "User not found" }, { status: 404 }) };

  const project = await prisma.project.findFirst({ where: { id: projectId, userId: user.id }, select: { id: true } });
  if (!project) return { error: NextResponse.json({ error: "Project not found" }, { status: 404 }) };

  const comment = await prisma.projectComment.findFirst({
    where: { id: commentId, projectId: project.id },
    select: { id: true, projectId: true, userId: true, message: true, _count: { select: { attachments: true } } },
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
    const message = typeof body.message === "string" ? body.message.trim() : "";

    if (!message && result.comment._count.attachments === 0) {
      return NextResponse.json({ error: "Edited message cannot be empty unless it has attachments." }, { status: 400 });
    }

    const updatedComment = await prisma.projectComment.update({
      where: { id: result.comment.id },
      data: { message },
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

    await prisma.projectComment.delete({ where: { id: result.comment.id } });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("DELETE /api/projects/[id]/comments/[commentId] error:", error);
    return NextResponse.json({ error: "Failed to delete project comment" }, { status: 500 });
  }
}
