import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/lib/auth";
import { createActivity } from "@/lib/activity";
import { getProjectAccess, canEditProjectContent, unauthorizedProjectResponse } from "@/lib/project-access";
import { markChatsRead } from "@/lib/project-chat-unread";
import {
  confirmProjectChatDirectUploadedAttachment,
  isProjectChatStorageConfigError,
  projectChatS3UploadBytes,
  uploadAndPersistProjectChatAttachments,
  type ProjectChatStoredAttachment,
} from "@/lib/project-chat-storage";
import {
  assertProjectChatGuestUploadsAllowed,
  assertProjectChatS3Quota,
  isProjectChatQuotaConfigError,
  isProjectChatQuotaError,
  lockProjectChatQuota,
  projectChatQuotaConfig,
} from "@/lib/project-chat-quota";
import {
  attachmentSizeLimit,
  formatAttachmentSize,
  MAX_FILES_PER_MESSAGE,
  validateProjectChatAttachment,
} from "@/lib/project-chat-attachment-validation";

type RouteContext = { params: Promise<{ id: string }> };

class ProjectChatCommentRequestError extends Error {}

function serializeAttachment(attachment: ProjectChatStoredAttachment & { id: string; createdAt: Date }) {
  return {
    id: attachment.id,
    fileName: attachment.fileName,
    originalName: attachment.originalName,
    fileType: attachment.fileType,
    fileSize: attachment.fileSize,
    url: attachment.url,
    createdAt: attachment.createdAt.toISOString(),
  };
}

function parsePreparedAttachmentIds(value: unknown) {
  if (value === undefined || value === null || value === "") return [];

  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new ProjectChatCommentRequestError("Invalid prepared attachment metadata.");
    }
  }

  if (!Array.isArray(parsed)) throw new ProjectChatCommentRequestError("Invalid prepared attachment metadata.");

  const ids = parsed.map((item) => {
    if (typeof item === "string") return item;
    if (item && typeof item === "object" && typeof (item as Record<string, unknown>).uploadId === "string") {
      return (item as { uploadId: string }).uploadId;
    }
    return null;
  });

  if (ids.some((id) => !id)) throw new ProjectChatCommentRequestError("Invalid prepared attachment metadata.");
  return ids as string[];
}

async function parseCommentRequest(req: Request) {
  const contentType = req.headers.get("content-type") || "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await req.formData();
    const messageInput = formData.get("message");
    const message = typeof messageInput === "string" ? messageInput.trim() : "";
    const files = formData
      .getAll("attachments")
      .filter((value): value is File => value instanceof File && value.size > 0);

    return {
      message,
      files,
      preparedAttachmentIds: parsePreparedAttachmentIds(formData.get("preparedAttachmentIds")),
    };
  }

  const body = await req.json().catch(() => ({}));
  const message = typeof body.message === "string" ? body.message.trim() : "";
  return {
    message,
    files: [] as File[],
    preparedAttachmentIds: parsePreparedAttachmentIds(body.preparedAttachmentIds),
  };
}

async function confirmedPreparedAttachments({
  projectId,
  userId,
  uploadIds,
}: {
  projectId: string;
  userId: string;
  uploadIds: string[];
}) {
  if (uploadIds.length === 0) return [];
  if (new Set(uploadIds).size !== uploadIds.length) {
    throw new ProjectChatCommentRequestError("Duplicate prepared attachments are not allowed.");
  }

  const uploads = await prisma.projectChatAttachmentUpload.findMany({
    where: { id: { in: uploadIds }, projectId, userId },
  });
  const uploadById = new Map(uploads.map((upload) => [upload.id, upload]));
  const orderedUploads = uploadIds.map((uploadId) => uploadById.get(uploadId));

  if (orderedUploads.some((upload) => !upload)) {
    throw new ProjectChatCommentRequestError("Prepared attachment upload was not found.");
  }
  if (orderedUploads.some((upload) => upload && upload.expiresAt <= new Date())) {
    throw new ProjectChatCommentRequestError("Prepared attachment upload expired. Attach the file again.");
  }

  const attachments = orderedUploads.map((upload) => {
    if (!upload) throw new ProjectChatCommentRequestError("Prepared attachment upload was not found.");
    return {
      fileName: upload.fileName,
      originalName: upload.originalName,
      fileType: upload.fileType,
      fileSize: upload.fileSize,
      url: upload.url,
      storageProvider: upload.storageProvider,
      storageKey: upload.storageKey,
    };
  });

  await Promise.all(attachments.map(confirmProjectChatDirectUploadedAttachment));
  return attachments;
}

/**
 * The project chat for any member (viewers included), polled by the open chat.
 * `version` sums up the thread: count, latest edit and pinned count, so adds,
 * edits, deletes and pins all change it. When the caller already has the
 * current version, only that is returned.
 */
export async function GET(req: Request, context: RouteContext) {
  try {
    const { id: projectId } = await context.params;
    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    const access = await getProjectAccess(projectId, user.id);
    if (!access) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const [summary, pinned] = await Promise.all([
      prisma.projectComment.aggregate({ where: { projectId }, _count: { _all: true }, _max: { updatedAt: true } }),
      prisma.projectComment.count({ where: { projectId, pinned: true } }),
    ]);
    const version = `${summary._count._all}:${summary._max.updatedAt?.getTime() ?? 0}:${pinned}`;
    if (new URL(req.url).searchParams.get("version") === version) {
      return NextResponse.json({ version, changed: false });
    }

    const comments = await prisma.projectComment.findMany({
      where: { projectId },
      orderBy: { createdAt: "asc" },
      include: { user: { select: { name: true, email: true } }, attachments: { orderBy: { createdAt: "asc" } } },
    });
    return NextResponse.json({
      version,
      changed: true,
      comments: comments.map((comment) => ({
        id: comment.id,
        message: comment.message,
        pinned: comment.pinned,
        createdAt: comment.createdAt.toISOString(),
        updatedAt: comment.updatedAt.toISOString(),
        author: { name: comment.user.name, email: comment.user.email },
        attachments: comment.attachments.map(serializeAttachment),
      })),
    });
  } catch (error) {
    console.error("GET /api/projects/[id]/comments error:", error);
    return NextResponse.json({ error: "Failed to load the project chat" }, { status: 500 });
  }
}

export async function POST(req: Request, context: RouteContext) {
  try {
    const { id: projectId } = await context.params;
    const { message, files, preparedAttachmentIds } = await parseCommentRequest(req);

    if (!message && files.length === 0 && preparedAttachmentIds.length === 0) {
      return NextResponse.json({ error: "Message or attachment is required" }, { status: 400 });
    }

    if (files.length + preparedAttachmentIds.length > MAX_FILES_PER_MESSAGE) {
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
    if (!canEditProjectContent(access)) return NextResponse.json(unauthorizedProjectResponse("post comments or upload attachments"), { status: 403 });
    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, name: true } });
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    // Prepared uploads were counted when their upload URLs were issued; only
    // files sent in this request add new bytes to S3.
    const quotaConfig = files.length > 0 || preparedAttachmentIds.length > 0 ? projectChatQuotaConfig() : null;
    if (quotaConfig) assertProjectChatGuestUploadsAllowed(user, quotaConfig);
    const incomingS3Bytes = projectChatS3UploadBytes(files);
    if (quotaConfig && incomingS3Bytes > 0) {
      await assertProjectChatS3Quota(prisma, { userId: user.id, incomingBytes: incomingS3Bytes, config: quotaConfig });
    }

    const preparedAttachments = await confirmedPreparedAttachments({
      projectId: project.id,
      userId: user.id,
      uploadIds: preparedAttachmentIds,
    });

    const comment = await uploadAndPersistProjectChatAttachments(
      files,
      (storedAttachments) => prisma.$transaction(async (tx) => {
        if (quotaConfig && incomingS3Bytes > 0) {
          // Check again under the lock: a parallel request may have used the
          // space while these files uploaded. Failing here deletes them again.
          await lockProjectChatQuota(tx);
          await assertProjectChatS3Quota(tx, { userId: user.id, incomingBytes: incomingS3Bytes, config: quotaConfig });
        }
        const createdComment = await tx.projectComment.create({
          data: {
            projectId: project.id,
            userId: user.id,
            message,
            attachments: {
              create: storedAttachments.map((attachment) => ({ ...attachment, userId: user.id })),
            },
          },
          include: {
            user: { select: { name: true, email: true } },
            attachments: { orderBy: { createdAt: "asc" } },
          },
        });
        if (preparedAttachmentIds.length > 0) {
          await tx.projectChatAttachmentUpload.deleteMany({
            where: { id: { in: preparedAttachmentIds }, projectId: project.id, userId: user.id },
          });
        }
        return createdComment;
      }),
      preparedAttachments,
    );

    // Posting means the author has read the chat so far.
    await markChatsRead(user.id, [project.id]);

    await createActivity({
      userId: user.id,
      projectId: project.id,
      action: "COMMENTED",
      entityType: "PROJECT",
      entityId: project.id,
      message: `Added a discussion comment in project \"${project.name}\".`,
    });

    return NextResponse.json(
      {
        id: comment.id,
        message: comment.message,
        pinned: comment.pinned,
        createdAt: comment.createdAt.toISOString(),
        updatedAt: comment.updatedAt.toISOString(),
        author: { name: comment.user.name, email: comment.user.email },
        attachments: comment.attachments.map(serializeAttachment),
      },
      { status: 201 },
    );
  } catch (error) {
    if (isProjectChatQuotaError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("POST /api/projects/[id]/comments error:", error);
    if (error instanceof ProjectChatCommentRequestError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (isProjectChatStorageConfigError(error) || isProjectChatQuotaConfigError(error)) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ error: "Failed to create project comment" }, { status: 500 });
  }
}
