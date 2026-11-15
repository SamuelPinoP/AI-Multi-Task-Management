import "server-only";

import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { BACKUP_PREFIX } from "@/lib/database-backup-core";
import { recentEmailCounts, type RecentEmailCounts } from "@/lib/email-counts";
import { prisma } from "@/lib/prisma";
import { projectChatQuotaConfig, projectChatS3TotalBytes } from "@/lib/project-chat-quota";
import { configuredUploadProviders, projectChatS3Target } from "@/lib/project-chat-storage";
import { emailSending, summarizeBackups, type BackupSummary, type EmailSending } from "@/lib/usage-core";

export type UsageReport = {
  measuredAt: Date;
  storage:
    | {
        status: "r2";
        /** Saved attachments plus pending direct uploads, as the upload cap counts them. */
        attachmentBytes: number;
        /** The app's own cap on those bytes (PROJECT_CHAT_S3_QUOTA_BYTES). */
        attachmentCapBytes: number;
        /** Null when the bucket couldn't be listed. */
        backups: BackupSummary | null;
      }
    | { status: "none"; providers: string[] };
  databaseBytes: number;
  email: { sending: EmailSending; counts: RecentEmailCounts };
  totals: { accounts: number; guests: number; projects: number; attachments: number };
};

/** The database backups in the bucket (#195): one list request, since only the newest 30 are kept. */
function listBackups({ bucket, client }: NonNullable<ReturnType<typeof projectChatS3Target>>): Promise<BackupSummary> {
  return summarizeBackups((token) => client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: BACKUP_PREFIX, ContinuationToken: token })));
}

async function storageUsage(): Promise<UsageReport["storage"]> {
  const target = projectChatS3Target();
  if (!target) {
    const { defaultProvider, videoProvider } = configuredUploadProviders();
    return { status: "none", providers: [...new Set([defaultProvider, videoProvider])] };
  }
  const [attachmentBytes, backups] = await Promise.all([
    projectChatS3TotalBytes(prisma),
    listBackups(target).catch((error: unknown) => {
      console.warn("usage_backup_list_failed", { error: error instanceof Error ? error.name : "UnknownError" });
      return null;
    }),
  ]);
  return { status: "r2", attachmentBytes, attachmentCapBytes: projectChatQuotaConfig().totalBytes, backups };
}

/**
 * Everything the free-tier usage page shows (#286), measured now: a few counts and sums, the
 * database's size and one R2 list request. Nothing polls; it runs only when the page opens.
 */
export async function getUsageReport(now = new Date()): Promise<UsageReport> {
  const [storage, [{ bytes: databaseBytes }], counts, accounts, guests, projects, attachments] = await Promise.all([
    storageUsage(),
    prisma.$queryRaw<{ bytes: bigint }[]>`SELECT pg_database_size(current_database()) AS bytes`,
    recentEmailCounts(prisma, now),
    prisma.user.count({ where: { isGuest: false } }),
    prisma.user.count({ where: { isGuest: true } }),
    prisma.project.count(),
    prisma.projectCommentAttachment.count(),
  ]);

  return {
    measuredAt: now,
    storage,
    databaseBytes: Number(databaseBytes),
    email: { sending: emailSending(process.env), counts },
    totals: { accounts, guests, projects, attachments },
  };
}
