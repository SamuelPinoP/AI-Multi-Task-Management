import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/lib/auth";
import { getProjectAccess } from "@/lib/project-access";
import { parseByteRange } from "@/lib/http-range";
import {
  isPreviewableDocxAttachment,
  projectChatDocxPreviewResponse,
} from "@/lib/project-chat-attachment-preview";
import {
  projectChatAttachmentContentDisposition,
  readProjectChatAttachment,
  type ProjectChatAttachmentDisposition,
} from "@/lib/project-chat-storage";

export const runtime = "nodejs";

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
    if (disposition === "inline" && isPreviewableDocxAttachment(attachmentName, attachment.fileType)) {
      return projectChatDocxPreviewResponse(attachment, attachmentName);
    }

    const storedFile = await readProjectChatAttachment(attachment, {
      disposition,
      fileName: attachmentName,
    });
    if (storedFile.kind === "redirect") {
      return NextResponse.redirect(storedFile.url, { status: 307 });
    }

    const headers: Record<string, string> = {
      "Content-Type": storedFile.contentType,
      "Content-Disposition": projectChatAttachmentContentDisposition(attachmentName, disposition),
      "X-Content-Type-Options": "nosniff",
    };

    // Local files arrive as one buffer: answer Range requests so videos can
    // seek (Safari won't play video at all without them).
    if (storedFile.body instanceof Uint8Array) {
      const body = storedFile.body;
      const size = body.byteLength;
      headers["Accept-Ranges"] = "bytes";
      const range = parseByteRange(req.headers.get("range"), size);
      if (range === "unsatisfiable") {
        return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
      }
      if (range) {
        return new Response(body.subarray(range.start, range.end + 1) as Uint8Array<ArrayBuffer>, {
          status: 206,
          headers: {
            ...headers,
            "Content-Length": String(range.end - range.start + 1),
            "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
          },
        });
      }
      return new Response(body, { headers: { ...headers, "Content-Length": String(size) } });
    }

    return new Response(storedFile.body, {
      headers: { ...headers, "Content-Length": String(attachment.fileSize) },
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
