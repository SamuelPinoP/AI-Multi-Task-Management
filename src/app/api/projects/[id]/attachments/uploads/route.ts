import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/lib/auth";
import { getProjectAccess, canEditProjectContent, unauthorizedProjectResponse } from "@/lib/project-access";
import {
  createProjectChatAttachmentUploadPlan,
  isProjectChatStorageConfigError,
} from "@/lib/project-chat-storage";
import {
  attachmentSizeLimit,
  formatAttachmentSize,
  MAX_FILES_PER_MESSAGE,
  validateProjectChatAttachment,
} from "@/lib/project-chat-attachment-validation";

type RouteContext = { params: Promise<{ id: string }> };
type AttachmentUploadRequestFile = {
  clientId: string;
  name: string;
  type: string;
  size: number;
};

function parseRequestedFile(value: unknown): AttachmentUploadRequestFile | null {
  if (!value || typeof value !== "object") return null;
  const file = value as Record<string, unknown>;
  if (typeof file.clientId !== "string" || !file.clientId) return null;
  if (typeof file.name !== "string" || !file.name) return null;
  if (typeof file.type !== "string") return null;
  if (typeof file.size !== "number" || !Number.isFinite(file.size) || file.size < 0) return null;
  return { clientId: file.clientId, name: file.name, type: file.type, size: file.size };
}

export async function POST(req: Request, context: RouteContext) {
  try {
    const { id: projectId } = await context.params;
    const body = (await req.json().catch(() => null)) as unknown;
    const filesInput = body && typeof body === "object" && "files" in body
      ? (body as { files?: unknown }).files
      : undefined;
    const requestedFiles = Array.isArray(filesInput)
      ? filesInput.map((file: unknown) => parseRequestedFile(file))
      : null;

    if (!requestedFiles || requestedFiles.some((file) => !file)) {
      return NextResponse.json({ error: "Valid attachment metadata is required." }, { status: 400 });
    }

    const files = requestedFiles as AttachmentUploadRequestFile[];
    if (files.length === 0) {
      return NextResponse.json({ error: "At least one attachment is required." }, { status: 400 });
    }
    if (files.length > MAX_FILES_PER_MESSAGE) {
      return NextResponse.json({ error: `Please attach ${MAX_FILES_PER_MESSAGE} files or fewer per message.` }, { status: 400 });
    }

    const oversizedFile = files.find((file) => validateProjectChatAttachment(file) === "too-large");
    if (oversizedFile) {
      return NextResponse.json(
        { error: `${oversizedFile.name} is ${formatAttachmentSize(oversizedFile.size)} and exceeds the ${formatAttachmentSize(attachmentSizeLimit(oversizedFile))} limit for this file type.` },
        { status: 400 },
      );
    }

    const unsafeFile = files.find((file) => validateProjectChatAttachment(file));
    if (unsafeFile) {
      return NextResponse.json({ error: `${unsafeFile.name} is not an allowed attachment type.` }, { status: 400 });
    }

    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    const access = await getProjectAccess(projectId, user.id);
    if (!access) return NextResponse.json({ error: "Project not found" }, { status: 404 });
    if (!canEditProjectContent(access)) return NextResponse.json(unauthorizedProjectResponse("upload attachments"), { status: 403 });

    const plans = await Promise.all(files.map(async (file) => {
      const plan = await createProjectChatAttachmentUploadPlan(file);
      if (plan.strategy === "multipart") {
        return {
          clientId: file.clientId,
          strategy: "multipart" as const,
          provider: plan.provider,
        };
      }

      const expiresAt = new Date(Date.now() + plan.expiresIn * 1000);
      const upload = await prisma.projectChatAttachmentUpload.create({
        data: {
          projectId,
          userId: user.id,
          ...plan.storedAttachment,
          expiresAt,
        },
        select: { id: true },
      });

      return {
        clientId: file.clientId,
        strategy: "direct-s3" as const,
        uploadId: upload.id,
        uploadUrl: plan.uploadUrl,
        uploadMethod: plan.uploadMethod,
        uploadHeaders: plan.uploadHeaders,
        expiresAt: expiresAt.toISOString(),
      };
    }));

    return NextResponse.json({ files: plans });
  } catch (error) {
    console.error("POST /api/projects/[id]/attachments/uploads error:", error);
    if (isProjectChatStorageConfigError(error)) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ error: "Failed to prepare attachment uploads" }, { status: 500 });
  }
}
