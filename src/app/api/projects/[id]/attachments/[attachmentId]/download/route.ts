import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/lib/auth";
import { getProjectAccess } from "@/lib/project-access";
import {
  projectChatAttachmentContentDisposition,
  readProjectChatAttachment,
  type ProjectChatAttachmentDisposition,
} from "@/lib/project-chat-storage";

type RouteContext = { params: Promise<{ id: string; attachmentId: string }> };

export async function GET(req: Request, context: RouteContext) {
  try {
    const { id: projectId, attachmentId } = await context.params;
    const disposition: ProjectChatAttachmentDisposition = new URL(req.url).searchParams.get("download") === "1" ? "attachment" : "inline";
    const user = await requireApiUser();
    if (!user)
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );

    const access = await getProjectAccess(projectId, user.id);
    if (!access)
      return NextResponse.json({ error: "Project not found" }, { status: 404 });

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

    if (!attachment)
      return NextResponse.json(
        { error: "Attachment not found" },
        { status: 404 },
      );

    const attachmentName = attachment.originalName || attachment.fileName;
    const storedFile = await readProjectChatAttachment(attachment, {
      disposition,
      fileName: attachmentName,
    });
    if (storedFile.kind === "redirect") {
      return NextResponse.redirect(storedFile.url, { status: 307 });
    }

    return new Response(storedFile.body, {
      headers: {
        "Content-Type": storedFile.contentType,
        "Content-Length": String(attachment.fileSize),
        "Content-Disposition": projectChatAttachmentContentDisposition(attachmentName, disposition),
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error(
      "GET /api/projects/[id]/attachments/[attachmentId]/download error:",
      error,
    );
    return NextResponse.json(
      { error: "Failed to download attachment" },
      { status: 500 },
    );
  }
}
