import type { Prisma } from "@prisma/client";
import type { ProjectChatStoredAttachmentReference } from "@/lib/project-chat-storage";

// Cloudflare R2 has no spending cap, so the app caps what it stores in the
// aws-s3 provider itself. The default leaves headroom under R2's 10 GB free tier.
export const DEFAULT_PROJECT_CHAT_S3_QUOTA_BYTES = 8 * 1024 ** 3;
export const DEFAULT_PROJECT_CHAT_USER_QUOTA_BYTES = 500 * 1024 ** 2;

/**
 * Expired direct uploads keep counting for this long before cleanup deletes
 * them, so a PUT that started just before its URL expired is still covered.
 */
export const EXPIRED_UPLOAD_CLEANUP_GRACE_MS = 60 * 60 * 1000;
const EXPIRED_UPLOAD_CLEANUP_BATCH_SIZE = 25;

// Any fixed key works; it only has to be the same for every upload request.
const PROJECT_CHAT_QUOTA_LOCK_KEY = 7_340_119;

export const PROJECT_CHAT_STORAGE_FULL_MESSAGE =
  "Storage is full for this workspace. Delete old attachments or ask the owner.";
export const PROJECT_CHAT_USER_QUOTA_MESSAGE =
  "You've reached your file storage limit. Delete old attachments to free up space.";
export const PROJECT_CHAT_GUEST_UPLOADS_MESSAGE =
  "Guest workspaces can't upload files. Create an account to attach files.";

export type ProjectChatQuotaConfig = {
  totalBytes: number;
  userBytes: number;
  guestUploadsEnabled: boolean;
};

export type ProjectChatS3Usage = {
  totalBytes: number;
  userBytes: number;
};

type QuotaDb = Pick<Prisma.TransactionClient, "projectCommentAttachment" | "projectChatAttachmentUpload">;
type UploadCleanupDb = Pick<Prisma.TransactionClient, "projectChatAttachmentUpload">;

export class ProjectChatQuotaConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectChatQuotaConfigError";
  }
}

/** An upload the quota refuses. Routes answer it with HTTP 413. */
export class ProjectChatQuotaError extends Error {
  readonly status = 413;

  constructor(message: string) {
    super(message);
    this.name = "ProjectChatQuotaError";
  }
}

export function isProjectChatQuotaError(error: unknown): error is ProjectChatQuotaError {
  return error instanceof ProjectChatQuotaError;
}

export function isProjectChatQuotaConfigError(error: unknown): error is ProjectChatQuotaConfigError {
  return error instanceof ProjectChatQuotaConfigError;
}

function parseByteLimit(value: string | undefined, variable: string, fallback: number) {
  const cleaned = value?.trim();
  if (!cleaned) return fallback;
  const bytes = Number(cleaned);
  if (!/^\d+$/.test(cleaned) || !Number.isSafeInteger(bytes)) {
    throw new ProjectChatQuotaConfigError(`${variable} must be a whole number of bytes.`);
  }
  return bytes;
}

/** Guest uploads stay off unless the switch is exactly "true". */
export function projectChatGuestUploadsEnabled(env: Record<string, string | undefined> = process.env) {
  return env.PROJECT_CHAT_GUEST_UPLOADS_ENABLED?.trim().toLowerCase() === "true";
}

export function projectChatQuotaConfig(env: Record<string, string | undefined> = process.env): ProjectChatQuotaConfig {
  return {
    totalBytes: parseByteLimit(env.PROJECT_CHAT_S3_QUOTA_BYTES, "PROJECT_CHAT_S3_QUOTA_BYTES", DEFAULT_PROJECT_CHAT_S3_QUOTA_BYTES),
    userBytes: parseByteLimit(env.PROJECT_CHAT_USER_QUOTA_BYTES, "PROJECT_CHAT_USER_QUOTA_BYTES", DEFAULT_PROJECT_CHAT_USER_QUOTA_BYTES),
    guestUploadsEnabled: projectChatGuestUploadsEnabled(env),
  };
}

export function assertProjectChatGuestUploadsAllowed(user: { isGuest: boolean }, config: ProjectChatQuotaConfig) {
  if (user.isGuest && !config.guestUploadsEnabled) {
    throw new ProjectChatQuotaError(PROJECT_CHAT_GUEST_UPLOADS_MESSAGE);
  }
}

/** Returns the message to refuse with, or null when the new bytes fit. */
export function projectChatQuotaRejection({
  config,
  usage,
  incomingBytes,
}: {
  config: ProjectChatQuotaConfig;
  usage: ProjectChatS3Usage;
  incomingBytes: number;
}) {
  if (incomingBytes <= 0) return null;
  if (usage.totalBytes + incomingBytes > config.totalBytes) return PROJECT_CHAT_STORAGE_FULL_MESSAGE;
  if (usage.userBytes + incomingBytes > config.userBytes) return PROJECT_CHAT_USER_QUOTA_MESSAGE;
  return null;
}

/**
 * Bytes in the aws-s3 provider (Cloudflare R2): saved attachments plus every
 * pending direct upload. Pending uploads count until cleanup deletes them, even
 * after they expire, because the browser may already have put the object.
 */
export async function projectChatS3Usage(db: QuotaDb, userId: string): Promise<ProjectChatS3Usage> {
  const [attachments, userAttachments, uploads, userUploads] = await Promise.all([
    db.projectCommentAttachment.aggregate({ where: { storageProvider: "AWS_S3" }, _sum: { fileSize: true } }),
    db.projectCommentAttachment.aggregate({ where: { storageProvider: "AWS_S3", userId }, _sum: { fileSize: true } }),
    db.projectChatAttachmentUpload.aggregate({ where: { storageProvider: "AWS_S3" }, _sum: { fileSize: true } }),
    db.projectChatAttachmentUpload.aggregate({ where: { storageProvider: "AWS_S3", userId }, _sum: { fileSize: true } }),
  ]);

  return {
    totalBytes: (attachments._sum.fileSize ?? 0) + (uploads._sum.fileSize ?? 0),
    userBytes: (userAttachments._sum.fileSize ?? 0) + (userUploads._sum.fileSize ?? 0),
  };
}

/** Throws a ProjectChatQuotaError when the new bytes would pass either limit. */
export async function assertProjectChatS3Quota(
  db: QuotaDb,
  { userId, incomingBytes, config }: { userId: string; incomingBytes: number; config: ProjectChatQuotaConfig },
) {
  if (incomingBytes <= 0) return;
  const usage = await projectChatS3Usage(db, userId);
  const rejection = projectChatQuotaRejection({ config, usage, incomingBytes });
  if (rejection) throw new ProjectChatQuotaError(rejection);
}

/**
 * Serializes quota checks until the surrounding transaction ends, so two
 * requests can't both see the same free space and together pass the limit.
 */
export async function lockProjectChatQuota(tx: Pick<Prisma.TransactionClient, "$executeRaw">) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PROJECT_CHAT_QUOTA_LOCK_KEY}::bigint)`;
}

/**
 * Deletes the stored objects of direct uploads that expired more than the grace
 * period ago, then their rows. A row whose object can't be deleted stays (and
 * keeps counting) so a later request can retry. Returns how many were removed.
 */
export async function cleanupExpiredProjectChatUploads({
  db,
  deleteStoredObjects,
  now = new Date(),
  limit = EXPIRED_UPLOAD_CLEANUP_BATCH_SIZE,
}: {
  db: UploadCleanupDb;
  deleteStoredObjects: (attachments: ProjectChatStoredAttachmentReference[]) => Promise<void>;
  now?: Date;
  limit?: number;
}) {
  const expired = await db.projectChatAttachmentUpload.findMany({
    where: { expiresAt: { lt: new Date(now.getTime() - EXPIRED_UPLOAD_CLEANUP_GRACE_MS) } },
    orderBy: { expiresAt: "asc" },
    take: limit,
    select: { id: true, storageProvider: true, storageKey: true, fileType: true, url: true },
  });
  if (expired.length === 0) return 0;

  const results = await Promise.allSettled(expired.map((upload) => deleteStoredObjects([upload])));
  const removedIds = expired.filter((_, index) => results[index].status === "fulfilled").map((upload) => upload.id);
  const failed = expired.length - removedIds.length;
  if (failed > 0) {
    console.error("project_chat_expired_upload_cleanup_failed", { failed });
  }
  if (removedIds.length > 0) {
    await db.projectChatAttachmentUpload.deleteMany({ where: { id: { in: removedIds } } });
  }
  return removedIds.length;
}
