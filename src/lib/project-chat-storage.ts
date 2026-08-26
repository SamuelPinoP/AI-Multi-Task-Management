import "server-only";

import { randomUUID } from "crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { del, head, put } from "@vercel/blob";
import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import path from "path";
import {
  attachmentContentType,
  sanitizeAttachmentName,
  validateProjectChatAttachment,
} from "@/lib/project-chat-attachment-validation";

const DEFAULT_PUBLIC_UPLOAD_PATH = "/uploads/project-chat";
const DEFAULT_STORAGE_PREFIX = "project-chat";
const DEFAULT_PRESIGNED_EXPIRATION_SECONDS = 600;
const LOCAL_UPLOAD_DIR = path.join(process.cwd(), "public", "uploads", "project-chat");

export type StorageProvider = "local" | "vercel-blob" | "aws-s3";
export type DatabaseStorageProvider = "LOCAL" | "VERCEL_BLOB" | "AWS_S3";

export type ProjectChatStoredAttachment = {
  fileName: string;
  originalName: string;
  fileType: string;
  fileSize: number;
  url: string;
  storageProvider: DatabaseStorageProvider;
  storageKey: string;
};

export type ProjectChatStoredAttachmentReference = Pick<
  ProjectChatStoredAttachment,
  "storageProvider" | "storageKey" | "fileType" | "url"
>;

export type ProjectChatAttachmentUploadPlan =
  | { strategy: "multipart"; provider: StorageProvider }
  | {
      strategy: "direct-s3";
      storedAttachment: ProjectChatStoredAttachment;
      uploadUrl: string;
      uploadMethod: "PUT";
      uploadHeaders: Record<string, string>;
      expiresIn: number;
    };

export type ProjectChatAttachmentReadResult =
  | { kind: "body"; body: BodyInit; contentType: string }
  | { kind: "redirect"; url: string };

export class ProjectChatStorageConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectChatStorageConfigError";
  }
}

export function isProjectChatStorageConfigError(error: unknown): error is ProjectChatStorageConfigError {
  return error instanceof ProjectChatStorageConfigError;
}

type ProjectChatS3PresignCommand = GetObjectCommand | PutObjectCommand;
type ProjectChatS3Presign = (
  client: S3Client,
  command: ProjectChatS3PresignCommand,
  options: { expiresIn: number },
) => Promise<string>;

const presignProjectChatS3Url: ProjectChatS3Presign = (client, command, options) =>
  getSignedUrl(client, command, options);

export const projectChatStorageTestHooks = {
  createS3Client: (options: S3ClientConfig) => new S3Client(options),
  presign: presignProjectChatS3Url,
  blobPut: put,
  blobHead: head,
  blobDelete: del,
};

const APPLICATION_PROVIDER: Record<DatabaseStorageProvider, StorageProvider> = {
  LOCAL: "local",
  VERCEL_BLOB: "vercel-blob",
  AWS_S3: "aws-s3",
};

let legacyWarningPrinted = false;

function parseProvider(value: string | undefined, variable: string): StorageProvider | undefined {
  const cleaned = value?.trim();
  if (!cleaned) return undefined;
  if (cleaned === "local" || cleaned === "vercel-blob" || cleaned === "aws-s3") return cleaned;
  throw new ProjectChatStorageConfigError(`Invalid ${variable}. Use "local", "vercel-blob", or "aws-s3".`);
}

export function configuredUploadProviders(env: Record<string, string | undefined> = process.env) {
  const legacy = parseProvider(env.PROJECT_CHAT_STORAGE_PROVIDER, "PROJECT_CHAT_STORAGE_PROVIDER");
  const configuredDefault = parseProvider(env.PROJECT_CHAT_DEFAULT_STORAGE_PROVIDER, "PROJECT_CHAT_DEFAULT_STORAGE_PROVIDER");
  const configuredVideo = parseProvider(env.PROJECT_CHAT_VIDEO_STORAGE_PROVIDER, "PROJECT_CHAT_VIDEO_STORAGE_PROVIDER");
  if (legacy && !legacyWarningPrinted) {
    console.warn("project_chat_storage_deprecated_config", {
      variable: "PROJECT_CHAT_STORAGE_PROVIDER",
      replacement: ["PROJECT_CHAT_DEFAULT_STORAGE_PROVIDER", "PROJECT_CHAT_VIDEO_STORAGE_PROVIDER"],
    });
    legacyWarningPrinted = true;
  }
  const defaultProvider = configuredDefault || legacy || "local";
  const videoProvider = configuredVideo || legacy || defaultProvider;
  return { defaultProvider, videoProvider };
}

export function selectUploadProvider({
  mimeType,
  defaultProvider,
  videoProvider,
}: {
  mimeType: string;
  defaultProvider: StorageProvider;
  videoProvider: StorageProvider;
}) {
  return mimeType.startsWith("video/") ? videoProvider : defaultProvider;
}

function storagePrefix(value: string | undefined, variable: string) {
  const prefix = (value?.trim() || DEFAULT_STORAGE_PREFIX).replace(/^\/+|\/+$/g, "");
  if (!prefix || prefix.split("/").some((part) => part === "." || part === "..")) {
    throw new ProjectChatStorageConfigError(`${variable} is invalid.`);
  }
  return prefix;
}

function requireBlobToken() {
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  if (!token) throw new ProjectChatStorageConfigError("Vercel Blob storage is selected, but BLOB_READ_WRITE_TOKEN is missing.");
  return token;
}

function s3Config() {
  const region = process.env.AWS_REGION?.trim();
  const bucket = process.env.AWS_S3_BUCKET_NAME?.trim();
  if (!region || !bucket) {
    console.error("project_chat_storage_config_error", {
      provider: "aws-s3",
      missing: [!region && "AWS_REGION", !bucket && "AWS_S3_BUCKET_NAME"].filter(Boolean),
    });
    throw new ProjectChatStorageConfigError("AWS S3 storage requires AWS_REGION and AWS_S3_BUCKET_NAME.");
  }
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY?.trim();
  if (Boolean(accessKeyId) !== Boolean(secretAccessKey)) {
    throw new ProjectChatStorageConfigError("Set both AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY, or omit both to use the AWS default credential provider chain.");
  }
  const rawExpiration = process.env.AWS_S3_PRESIGNED_URL_EXPIRATION_SECONDS?.trim();
  const expiresIn = rawExpiration ? Number(rawExpiration) : DEFAULT_PRESIGNED_EXPIRATION_SECONDS;
  if (!Number.isInteger(expiresIn) || expiresIn < 60 || expiresIn > 3600) {
    throw new ProjectChatStorageConfigError("AWS_S3_PRESIGNED_URL_EXPIRATION_SECONDS must be an integer from 60 through 3600.");
  }
  const forcePathStyle = process.env.AWS_S3_FORCE_PATH_STYLE?.trim();
  if (forcePathStyle && forcePathStyle !== "true" && forcePathStyle !== "false") {
    throw new ProjectChatStorageConfigError('AWS_S3_FORCE_PATH_STYLE must be "true" or "false".');
  }
  return {
    bucket,
    prefix: storagePrefix(process.env.PROJECT_CHAT_S3_PREFIX, "PROJECT_CHAT_S3_PREFIX"),
    expiresIn,
    client: projectChatStorageTestHooks.createS3Client({
      region,
      ...(process.env.AWS_S3_ENDPOINT?.trim() ? { endpoint: process.env.AWS_S3_ENDPOINT.trim() } : {}),
      ...(forcePathStyle ? { forcePathStyle: forcePathStyle === "true" } : {}),
      ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}),
    }),
  };
}

function assertLocalKey(key: string) {
  if (!key || key !== path.basename(key) || key.includes("..") || key.includes("\\")) throw new Error("Invalid local attachment key.");
}

function assertPrefixedKey(key: string, prefix: string, provider: StorageProvider) {
  if (!key.startsWith(`${prefix}/`) || key.includes("..") || key.includes("\\")) {
    throw new Error(`Invalid ${provider} attachment key.`);
  }
}

function resolveStoredProvider(value: unknown): StorageProvider {
  if (typeof value !== "string" || !(value in APPLICATION_PROVIDER)) throw new Error("Invalid stored attachment provider.");
  return APPLICATION_PROVIDER[value as DatabaseStorageProvider];
}

function s3StoredAttachment(file: Pick<File, "name" | "size">, prefix: string) {
  const originalName = sanitizeAttachmentName(file.name);
  const key = `${prefix}/${randomUUID()}-${originalName}`;
  const type = attachmentContentType(file);
  return {
    fileName: key,
    originalName,
    fileType: type,
    fileSize: file.size,
    url: `s3://${key}`,
    storageProvider: "AWS_S3" as const,
    storageKey: key,
  };
}

type StorageAdapter = {
  upload(file: File): Promise<ProjectChatStoredAttachment>;
  read(attachment: ProjectChatStoredAttachmentReference): Promise<ProjectChatAttachmentReadResult>;
  delete(attachment: ProjectChatStoredAttachmentReference): Promise<void>;
};

const localAdapter: StorageAdapter = {
  async upload(file) {
    await mkdir(LOCAL_UPLOAD_DIR, { recursive: true });
    const originalName = sanitizeAttachmentName(file.name);
    const key = `${randomUUID()}${path.extname(originalName).toLowerCase()}`;
    await writeFile(path.join(LOCAL_UPLOAD_DIR, key), Buffer.from(await file.arrayBuffer()));
    const publicPath = `/${(process.env.PROJECT_CHAT_PUBLIC_UPLOAD_PATH || DEFAULT_PUBLIC_UPLOAD_PATH).trim().replace(/^\/+|\/+$/g, "")}`;
    return { fileName: key, originalName, fileType: attachmentContentType(file), fileSize: file.size, url: `${publicPath}/${key}`, storageProvider: "LOCAL", storageKey: key };
  },
  async read(attachment) {
    assertLocalKey(attachment.storageKey);
    return { kind: "body", body: await readFile(path.join(LOCAL_UPLOAD_DIR, attachment.storageKey)), contentType: attachment.fileType };
  },
  async delete(attachment) {
    assertLocalKey(attachment.storageKey);
    await unlink(path.join(LOCAL_UPLOAD_DIR, attachment.storageKey)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  },
};

const blobAdapter: StorageAdapter = {
  async upload(file) {
    const token = requireBlobToken();
    const prefix = storagePrefix(process.env.PROJECT_CHAT_BLOB_PREFIX, "PROJECT_CHAT_BLOB_PREFIX");
    const originalName = sanitizeAttachmentName(file.name);
    const key = `${prefix}/${randomUUID()}${path.extname(originalName).toLowerCase()}`;
    const type = attachmentContentType(file);
    try {
      const blob = await projectChatStorageTestHooks.blobPut(key, file, { access: "public", addRandomSuffix: false, contentType: type, token, multipart: file.size > 10 * 1024 * 1024 });
      return { fileName: key, originalName, fileType: type, fileSize: file.size, url: blob.url, storageProvider: "VERCEL_BLOB", storageKey: key };
    } catch (error) {
      console.error("project_chat_storage_upload_failed", { provider: "vercel-blob", operation: "put", errorName: error instanceof Error ? error.name : "UnknownError" });
      throw new Error("The attachment could not be stored.");
    }
  },
  async read(attachment) {
    const token = requireBlobToken();
    const prefix = storagePrefix(process.env.PROJECT_CHAT_BLOB_PREFIX, "PROJECT_CHAT_BLOB_PREFIX");
    assertPrefixedKey(attachment.storageKey, prefix, "vercel-blob");
    try {
      const blob = await projectChatStorageTestHooks.blobHead(attachment.storageKey, { token });
      const response = await fetch(blob.url);
      if (!response.ok || !response.body) throw new Error("BlobFetchError");
      return { kind: "body", body: response.body, contentType: response.headers.get("content-type") || attachment.fileType };
    } catch (error) {
      console.error("project_chat_storage_download_failed", { provider: "vercel-blob", operation: "head/fetch", errorName: error instanceof Error ? error.name : "UnknownError" });
      throw new Error("The stored attachment could not be loaded.");
    }
  },
  async delete(attachment) {
    const token = requireBlobToken();
    const prefix = storagePrefix(process.env.PROJECT_CHAT_BLOB_PREFIX, "PROJECT_CHAT_BLOB_PREFIX");
    assertPrefixedKey(attachment.storageKey, prefix, "vercel-blob");
    try {
      await projectChatStorageTestHooks.blobDelete(attachment.storageKey, { token });
    } catch (error) {
      console.error("project_chat_storage_delete_failed", { provider: "vercel-blob", operation: "del", errorName: error instanceof Error ? error.name : "UnknownError" });
      throw new Error("The stored attachment could not be deleted.");
    }
  },
};

const s3Adapter: StorageAdapter = {
  async upload(file) {
    const config = s3Config();
    const storedAttachment = s3StoredAttachment(file, config.prefix);
    try {
      await config.client.send(new PutObjectCommand({ Bucket: config.bucket, Key: storedAttachment.storageKey, Body: Buffer.from(await file.arrayBuffer()), ContentType: storedAttachment.fileType }));
      return storedAttachment;
    } catch (error) {
      console.error("project_chat_storage_upload_failed", { provider: "aws-s3", operation: "PutObject", errorName: error instanceof Error ? error.name : "UnknownError" });
      throw new Error("The attachment could not be stored.");
    }
  },
  async read(attachment) {
    const config = s3Config();
    assertPrefixedKey(attachment.storageKey, config.prefix, "aws-s3");
    try {
      const url = await projectChatStorageTestHooks.presign(config.client, new GetObjectCommand({ Bucket: config.bucket, Key: attachment.storageKey }), { expiresIn: config.expiresIn });
      return { kind: "redirect", url };
    } catch (error) {
      console.error("project_chat_storage_download_url_failed", { provider: "aws-s3", operation: "GetObjectPresign", errorName: error instanceof Error ? error.name : "UnknownError" });
      throw new Error("A secure attachment download could not be prepared.");
    }
  },
  async delete(attachment) {
    const config = s3Config();
    assertPrefixedKey(attachment.storageKey, config.prefix, "aws-s3");
    try {
      await config.client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: attachment.storageKey }));
    } catch (error) {
      console.error("project_chat_storage_delete_failed", { provider: "aws-s3", operation: "DeleteObject", errorName: error instanceof Error ? error.name : "UnknownError" });
      throw new Error("The stored attachment could not be deleted.");
    }
  },
};

const PROVIDERS: Record<StorageProvider, StorageAdapter> = { local: localAdapter, "vercel-blob": blobAdapter, "aws-s3": s3Adapter };

export function resolveProjectChatStorageProvider(provider: StorageProvider) {
  return PROVIDERS[provider];
}

export async function createProjectChatAttachmentUploadPlan(file: Pick<File, "name" | "type" | "size">): Promise<ProjectChatAttachmentUploadPlan> {
  const invalid = validateProjectChatAttachment(file);
  if (invalid) throw new Error("Attachment validation failed before storage.");

  const type = attachmentContentType(file);
  const provider = selectUploadProvider({ mimeType: type, ...configuredUploadProviders() });
  if (provider !== "aws-s3") return { strategy: "multipart", provider };

  const config = s3Config();
  const storedAttachment = s3StoredAttachment(file, config.prefix);
  try {
    const command = new PutObjectCommand({
      Bucket: config.bucket,
      Key: storedAttachment.storageKey,
      ContentType: storedAttachment.fileType,
    });
    const uploadUrl = await projectChatStorageTestHooks.presign(config.client, command, { expiresIn: config.expiresIn });
    return {
      strategy: "direct-s3",
      storedAttachment,
      uploadUrl,
      uploadMethod: "PUT",
      uploadHeaders: { "Content-Type": storedAttachment.fileType },
      expiresIn: config.expiresIn,
    };
  } catch (error) {
    console.error("project_chat_storage_upload_url_failed", { provider: "aws-s3", operation: "PutObjectPresign", errorName: error instanceof Error ? error.name : "UnknownError" });
    throw new Error("A secure attachment upload could not be prepared.");
  }
}

export async function confirmProjectChatDirectUploadedAttachment(attachment: ProjectChatStoredAttachment) {
  if (attachment.storageProvider !== "AWS_S3") throw new Error("Only AWS S3 direct uploads can be confirmed.");
  const config = s3Config();
  assertPrefixedKey(attachment.storageKey, config.prefix, "aws-s3");
  try {
    const result = await config.client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: attachment.storageKey }));
    if (result.ContentLength !== attachment.fileSize) throw new Error("Uploaded attachment size did not match.");
    const storedContentType = result.ContentType?.split(";")[0]?.trim().toLowerCase();
    if (storedContentType && storedContentType !== attachment.fileType.toLowerCase()) {
      throw new Error("Uploaded attachment content type did not match.");
    }
  } catch (error) {
    try {
      await config.client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: attachment.storageKey }));
    } catch (cleanupError) {
      console.error("project_chat_storage_upload_confirm_cleanup_failed", { provider: "aws-s3", operation: "DeleteObject", errorName: cleanupError instanceof Error ? cleanupError.name : "UnknownError" });
    }
    console.error("project_chat_storage_upload_confirm_failed", { provider: "aws-s3", operation: "HeadObject", errorName: error instanceof Error ? error.name : "UnknownError" });
    throw new Error("The uploaded attachment could not be verified.");
  }
}

export async function saveProjectChatAttachments(files: File[]): Promise<ProjectChatStoredAttachment[]> {
  const invalid = files.find((file) => validateProjectChatAttachment(file));
  if (invalid) throw new Error("Attachment validation failed before storage.");
  const configured = configuredUploadProviders();
  return Promise.all(files.map((file) => {
    const type = attachmentContentType(file);
    const provider = selectUploadProvider({ mimeType: type, ...configured });
    return resolveProjectChatStorageProvider(provider).upload(file);
  }));
}

export async function readProjectChatAttachment(attachment: ProjectChatStoredAttachmentReference) {
  return resolveProjectChatStorageProvider(resolveStoredProvider(attachment.storageProvider)).read(attachment);
}

export async function deleteProjectChatAttachments(attachments: ProjectChatStoredAttachmentReference[]) {
  await Promise.all(attachments.map((attachment) => resolveProjectChatStorageProvider(resolveStoredProvider(attachment.storageProvider)).delete(attachment)));
}

export async function uploadAndPersistProjectChatAttachments<T>(
  files: File[],
  persist: (attachments: ProjectChatStoredAttachment[]) => Promise<T>,
  preuploadedAttachments: ProjectChatStoredAttachment[] = [],
) {
  let stored: ProjectChatStoredAttachment[] = [];
  try {
    stored = await saveProjectChatAttachments(files);
    return await persist([...preuploadedAttachments, ...stored]);
  } catch (persistenceError) {
    const attachmentsToDelete = [...preuploadedAttachments, ...stored];
    try {
      if (attachmentsToDelete.length > 0) await deleteProjectChatAttachments(attachmentsToDelete);
    } catch (cleanupError) {
      console.error("project_chat_storage_compensating_delete_failed", {
        operation: "uploadRollback",
        errorName: cleanupError instanceof Error ? cleanupError.name : "UnknownError",
      });
    }
    throw persistenceError;
  }
}
