import "server-only";

import { randomUUID } from "crypto";
import { del, put } from "@vercel/blob";
import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import path from "path";

const DEFAULT_PUBLIC_UPLOAD_PATH = "/uploads/project-chat";
const DEFAULT_BLOB_PREFIX = "project-chat";

export type ProjectChatStoredAttachment = {
  fileName: string;
  originalName: string;
  fileType: string;
  fileSize: number;
  url: string;
};

export type ProjectChatStoredAttachmentForDelete = Pick<
  ProjectChatStoredAttachment,
  "fileName" | "url"
>;

type StorageProvider = "local" | "vercel-blob";

export class ProjectChatStorageConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectChatStorageConfigError";
  }
}

export function isProjectChatStorageConfigError(
  error: unknown,
): error is ProjectChatStorageConfigError {
  return error instanceof ProjectChatStorageConfigError;
}

function selectedProvider(): StorageProvider {
  const configuredProvider = process.env.PROJECT_CHAT_STORAGE_PROVIDER?.trim();

  if (!configuredProvider) {
    if (process.env.NODE_ENV === "production") {
      throw new ProjectChatStorageConfigError(
        'Project Chat attachment storage is not configured. Set PROJECT_CHAT_STORAGE_PROVIDER to "vercel-blob" or explicitly set it to "local".',
      );
    }

    return "local";
  }

  if (configuredProvider === "local" || configuredProvider === "vercel-blob") {
    return configuredProvider;
  }

  throw new ProjectChatStorageConfigError(
    `Unsupported PROJECT_CHAT_STORAGE_PROVIDER "${configuredProvider}". Supported values are "local" and "vercel-blob".`,
  );
}

function safeOriginalName(name: string) {
  return (
    path
      .basename(name)
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .slice(0, 180) || "attachment"
  );
}

function safePublicPrefix(prefix: string) {
  const trimmed = prefix.trim() || DEFAULT_PUBLIC_UPLOAD_PATH;
  return `/${trimmed.replace(/^\/+|\/+$/g, "")}`;
}

const LOCAL_UPLOAD_DIR = path.join(
  process.cwd(),
  "public",
  "uploads",
  "project-chat",
);

function localUploadDir() {
  return LOCAL_UPLOAD_DIR;
}

function blobPrefix() {
  return (
    (
      process.env.PROJECT_CHAT_BLOB_PREFIX?.trim() || DEFAULT_BLOB_PREFIX
    ).replace(/^\/+|\/+$/g, "") || DEFAULT_BLOB_PREFIX
  );
}

async function saveFilesLocally(
  files: File[],
): Promise<ProjectChatStoredAttachment[]> {
  const uploadDir = localUploadDir();
  const publicUploadPath = safePublicPrefix(
    process.env.PROJECT_CHAT_PUBLIC_UPLOAD_PATH || DEFAULT_PUBLIC_UPLOAD_PATH,
  );
  await mkdir(uploadDir, { recursive: true });

  return Promise.all(
    files.map(async (file) => {
      const originalName = safeOriginalName(file.name);
      const extension = path.extname(originalName).toLowerCase();
      const fileName = `${randomUUID()}${extension}`;
      const buffer = Buffer.from(await file.arrayBuffer());
      await writeFile(path.join(uploadDir, fileName), buffer);

      return {
        fileName,
        originalName,
        fileType: file.type || "application/octet-stream",
        fileSize: file.size,
        url: `${publicUploadPath}/${fileName}`,
      };
    }),
  );
}

async function saveFilesToVercelBlob(
  files: File[],
): Promise<ProjectChatStoredAttachment[]> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    throw new ProjectChatStorageConfigError(
      "Vercel Blob storage is selected, but BLOB_READ_WRITE_TOKEN is missing. Add it as a server-side secret environment variable.",
    );
  }

  const prefix = blobPrefix();

  return Promise.all(
    files.map(async (file) => {
      const originalName = safeOriginalName(file.name);
      const extension = path.extname(originalName).toLowerCase();
      const pathname = `${prefix}/${randomUUID()}${extension}`;
      const blob = await put(pathname, file, {
        access: "public",
        addRandomSuffix: false,
        contentType: file.type || "application/octet-stream",
        token,
        multipart: file.size > 10 * 1024 * 1024,
      });

      return {
        fileName: blob.pathname,
        originalName,
        fileType: file.type || "application/octet-stream",
        fileSize: file.size,
        url: blob.url,
      };
    }),
  );
}

export async function saveProjectChatAttachments(
  files: File[],
): Promise<ProjectChatStoredAttachment[]> {
  if (files.length === 0) return [];

  const provider = selectedProvider();
  return provider === "vercel-blob"
    ? saveFilesToVercelBlob(files)
    : saveFilesLocally(files);
}

async function deleteLocalAttachment(
  attachment: ProjectChatStoredAttachmentForDelete,
) {
  const fileName = path.basename(attachment.fileName || attachment.url);
  if (!fileName) return;

  const uploadDir = localUploadDir();
  const fullPath = path.resolve(uploadDir, fileName);
  if (!fullPath.startsWith(`${uploadDir}${path.sep}`)) return;

  await unlink(fullPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}

async function deleteBlobAttachment(
  attachment: ProjectChatStoredAttachmentForDelete,
) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    throw new ProjectChatStorageConfigError(
      "Vercel Blob storage is selected, but BLOB_READ_WRITE_TOKEN is missing. Attachment metadata can still be removed, but blob cleanup cannot run.",
    );
  }

  await del(attachment.url || attachment.fileName, { token });
}

export async function deleteProjectChatAttachments(
  attachments: ProjectChatStoredAttachmentForDelete[],
) {
  if (attachments.length === 0) return;

  const provider = selectedProvider();
  await Promise.all(
    attachments.map((attachment) =>
      provider === "vercel-blob"
        ? deleteBlobAttachment(attachment)
        : deleteLocalAttachment(attachment),
    ),
  );
}

export type ProjectChatStoredAttachmentForDownload = Pick<
  ProjectChatStoredAttachment,
  "fileName" | "url" | "fileType"
>;

export async function readProjectChatAttachment(
  attachment: ProjectChatStoredAttachmentForDownload,
): Promise<{ body: BodyInit; contentType: string }> {
  const provider = selectedProvider();

  if (provider === "vercel-blob") {
    const response = await fetch(attachment.url);
    if (!response.ok || !response.body) {
      throw new Error("Stored attachment could not be loaded.");
    }

    return {
      body: response.body,
      contentType:
        response.headers.get("content-type") ||
        attachment.fileType ||
        "application/octet-stream",
    };
  }

  const uploadDir = localUploadDir();
  const fileName = path.basename(attachment.fileName || attachment.url);
  const fullPath = path.resolve(uploadDir, fileName);
  if (!fullPath.startsWith(`${uploadDir}${path.sep}`)) {
    throw new Error("Invalid stored attachment path.");
  }

  return {
    body: await readFile(fullPath),
    contentType: attachment.fileType || "application/octet-stream",
  };
}
