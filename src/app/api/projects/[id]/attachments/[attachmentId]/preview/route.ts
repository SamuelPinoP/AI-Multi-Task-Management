import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/lib/auth";
import { getProjectAccess } from "@/lib/project-access";
import {
  isPreviewableDocxAttachment,
  projectChatDocxPreviewResponse,
} from "@/lib/project-chat-attachment-preview";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string; attachmentId: string }> };

export async function GET(_req: Request, context: RouteContext) {
  try {
    const { id: projectId, attachmentId } = await context.params;
    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    const access = await getProjectAccess(projectId, user.id);
    if (!access) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const attachment = await prisma.projectCommentAttachment.findFirst({
      where: { id: attachmentId, comment: { projectId } },
      select: {
        fileName: true,
        originalName: true,
        fileType: true,
        fileSize: true,
        url: true,
        storageProvider: true,
        storageKey: true,
      },
    });

    if (!attachment) return NextResponse.json({ error: "Attachment not found" }, { status: 404 });

    const attachmentName = attachment.originalName || attachment.fileName;
    if (!isPreviewableDocxAttachment(attachmentName, attachment.fileType)) {
      return NextResponse.json({ error: "Attachment preview is not available for this file type" }, { status: 415 });
    }

    return projectChatDocxPreviewResponse(attachment, attachmentName);
  } catch (error) {
    console.error(
      "GET /api/projects/[id]/attachments/[attachmentId]/preview error:",
      error,
    );
    return NextResponse.json(
      { error: "Failed to preview attachment" },
      { status: 500 },
    );
  }
}
