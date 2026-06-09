import path from "path";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/lib/auth";
import { createActivity } from "@/lib/activity";
import { projectAccessWhereForProject } from "@/lib/project-access";
import {
  isProjectChatStorageConfigError,
  saveProjectChatAttachments,
  type ProjectChatStoredAttachment,
} from "@/lib/project-chat-storage";

const STANDARD_FILE_SIZE_LIMIT = 10 * 1024 * 1024;
const VIDEO_FILE_SIZE_LIMIT = 100 * 1024 * 1024;
const MAX_FILES_PER_MESSAGE = 5;

const ALLOWED_EXTENSIONS = new Set([
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".txt",
  ".csv",
  ".json",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".mp4",
  ".mov",
  ".webm",
  ".m4v",
  ".zip",
]);

const BLOCKED_EXTENSIONS = new Set([
  ".bat",
  ".cmd",
  ".com",
  ".cpl",
  ".dll",
  ".dmg",
  ".exe",
  ".hta",
  ".js",
  ".jar",
  ".msi",
  ".ps1",
  ".scr",
  ".sh",
  ".vbs",
]);

type RouteContext = { params: Promise<{ id: string }> };

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

function isAllowedFile(file: File) {
  const extension = path.extname(file.name).toLowerCase();
  return Boolean(extension) && ALLOWED_EXTENSIONS.has(extension) && !BLOCKED_EXTENSIONS.has(extension);
}

function isVideoFile(file: File) {
  const extension = path.extname(file.name).toLowerCase();
  return file.type.startsWith("video/") || [".mp4", ".mov", ".webm", ".m4v"].includes(extension);
}

function fileSizeLimit(file: File) {
  return isVideoFile(file) ? VIDEO_FILE_SIZE_LIMIT : STANDARD_FILE_SIZE_LIMIT;
}

function formatLimit(size: number) {
  return `${size / (1024 * 1024)} MB`;
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

    return { message, files };
  }

  const body = await req.json().catch(() => ({}));
  const message = typeof body.message === "string" ? body.message.trim() : "";
  return { message, files: [] as File[] };
}

export async function POST(req: Request, context: RouteContext) {
  try {
    const { id: projectId } = await context.params;
    const { message, files } = await parseCommentRequest(req);

    if (!message && files.length === 0) {
      return NextResponse.json({ error: "Message or attachment is required" }, { status: 400 });
    }

    if (files.length > MAX_FILES_PER_MESSAGE) {
      return NextResponse.json({ error: `Please attach ${MAX_FILES_PER_MESSAGE} files or fewer per message.` }, { status: 400 });
    }

    const oversizedFile = files.find((file) => file.size > fileSizeLimit(file));
    if (oversizedFile) {
      return NextResponse.json(
        { error: `${oversizedFile.name} is ${formatLimit(oversizedFile.size)} and exceeds the ${formatLimit(fileSizeLimit(oversizedFile))} limit for this file type.` },
        { status: 400 },
      );
    }

    const unsafeFile = files.find((file) => !isAllowedFile(file));
    if (unsafeFile) {
      return NextResponse.json({ error: `${unsafeFile.name} is not an allowed attachment type.` }, { status: 400 });
    }

    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    const project = await prisma.project.findFirst({ where: projectAccessWhereForProject(projectId, user.id), select: { id: true, name: true } });
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const storedAttachments = await saveProjectChatAttachments(files);

    const comment = await prisma.projectComment.create({
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

    await createActivity({
      userId: user.id,
      projectId: project.id,
      action: "CREATED_PROJECT",
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
    console.error("POST /api/projects/[id]/comments error:", error);
    if (isProjectChatStorageConfigError(error)) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ error: "Failed to create project comment" }, { status: 500 });
  }
}
