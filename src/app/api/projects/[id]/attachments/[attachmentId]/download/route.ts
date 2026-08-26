import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/lib/auth";
import { getProjectAccess } from "@/lib/project-access";
import { readProjectChatAttachment } from "@/lib/project-chat-storage";

type RouteContext = { params: Promise<{ id: string; attachmentId: string }> };

function sanitizeDownloadName(name: string) {
  return (
    name
      .replace(/[\\/]/g, "-")
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .trim()
      .slice(0, 180) || "attachment"
  );
}

function contentDisposition(fileName: string) {
  const safeName = sanitizeDownloadName(fileName);
  const fallbackName = safeName
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/["\\]/g, "_");
  return `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`;
}

export async function GET(_req: Request, context: RouteContext) {
  try {
    const { id: projectId, attachmentId } = await context.params;
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

    const storedFile = await readProjectChatAttachment(attachment);
    if (storedFile.kind === "redirect") {
      return NextResponse.redirect(storedFile.url, { status: 307 });
    }

    return new Response(storedFile.body, {
      headers: {
        "Content-Type": storedFile.contentType,
        "Content-Length": String(attachment.fileSize),
        "Content-Disposition": contentDisposition(
          attachment.originalName || attachment.fileName,
        ),
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
