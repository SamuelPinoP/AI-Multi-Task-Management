import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createActivity } from "@/lib/activity";

const DEMO_USER_EMAIL = "samuel@example.com";
const STANDARD_FILE_SIZE_LIMIT = 10 * 1024 * 1024;
const VIDEO_FILE_SIZE_LIMIT = 100 * 1024 * 1024;
const MAX_FILES_PER_MESSAGE = 5;
const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads", "project-chat");
const PUBLIC_UPLOAD_PATH = "/uploads/project-chat";

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

type StoredAttachment = {
  fileName: string;
  originalName: string;
  fileType: string;
  fileSize: number;
  url: string;
};

function serializeAttachment(attachment: StoredAttachment & { id: string; createdAt: Date }) {
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

function safeOriginalName(name: string) {
  return path.basename(name).replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 180) || "attachment";
}

async function storeFiles(files: File[]): Promise<StoredAttachment[]> {
  await mkdir(UPLOAD_DIR, { recursive: true });

  return Promise.all(
    files.map(async (file) => {
      const originalName = safeOriginalName(file.name);
      const extension = path.extname(originalName).toLowerCase();
      const fileName = `${randomUUID()}${extension}`;
      const buffer = Buffer.from(await file.arrayBuffer());
      await writeFile(path.join(UPLOAD_DIR, fileName), buffer);

      return {
        fileName,
        originalName,
        fileType: file.type || "application/octet-stream",
        fileSize: file.size,
        url: `${PUBLIC_UPLOAD_PATH}/${fileName}`,
      };
    }),
  );
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

    const user = await prisma.user.findUnique({ where: { email: DEMO_USER_EMAIL } });
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const project = await prisma.project.findFirst({ where: { id: projectId, userId: user.id }, select: { id: true, name: true } });
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const storedAttachments = files.length > 0 ? await storeFiles(files) : [];

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
    return NextResponse.json({ error: "Failed to create project comment" }, { status: 500 });
  }
}
