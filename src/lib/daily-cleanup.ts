import type { PrismaClient } from "@prisma/client";
import { cleanupExpiredProjectChatUploads } from "@/lib/project-chat-quota";
import type { ProjectChatStoredAttachmentReference } from "@/lib/project-chat-storage";

/** Guests are deleted this long after they started, once nobody can sign in to them any more. */
export const INACTIVE_GUEST_DAYS = 30;
/** Per run, so one call stays well inside the function's time limit; the rest goes the next day. */
const GUEST_BATCH_SIZE = 100;
const UPLOAD_CLEANUP_ROUNDS = 8;

const STORED_FILE_SELECT = { storageProvider: true, storageKey: true, fileType: true, url: true } as const;

type CleanupDb = Pick<
  PrismaClient,
  | "$executeRaw"
  | "session"
  | "passwordResetToken"
  | "emailVerificationToken"
  | "user"
  | "projectCommentAttachment"
  | "projectChatAttachmentUpload"
>;

export type DailyCleanupResult = {
  sessions: number;
  resetTokens: number;
  verificationTokens: number;
  rateLimits: number;
  guests: number;
  /** Guests skipped because a stored file couldn't be deleted; they are retried the next day. */
  guestsSkipped: number;
  uploads: number;
};

/**
 * Deletes what nobody can use any more (#132):
 * - expired sessions, used or expired password reset tokens, expired email confirmation links
 *   and expired rate-limit counters;
 * - guest workspaces older than INACTIVE_GUEST_DAYS without a valid session (a guest has no
 *   password, so once its session is gone nobody can reach it), with their data and stored files;
 * - direct chat uploads that expired without being attached, with their stored files.
 *
 * Running it again right away finds nothing new, so repeat calls are harmless.
 */
export async function runDailyCleanup({
  db,
  deleteStoredObjects,
  now = new Date(),
}: {
  db: CleanupDb;
  deleteStoredObjects: (files: ProjectChatStoredAttachmentReference[]) => Promise<void>;
  now?: Date;
}): Promise<DailyCleanupResult> {
  const sessions = await db.session.deleteMany({ where: { expiresAt: { lt: now } } });
  const resetTokens = await db.passwordResetToken.deleteMany({
    where: { OR: [{ usedAt: { not: null } }, { expiresAt: { lt: now } }] },
  });
  const verificationTokens = await db.emailVerificationToken.deleteMany({ where: { expiresAt: { lt: now } } });
  // RateLimit.expiresAt is timestamptz; compare in SQL, as src/lib/rate-limit.ts does, so the
  // database's own time zone can't shift the cutoff.
  const rateLimits = await db.$executeRaw`DELETE FROM "RateLimit" WHERE "expiresAt" < now()`;
  const guests = await deleteInactiveGuests({ db, deleteStoredObjects, now });

  let uploads = 0;
  for (let round = 0; round < UPLOAD_CLEANUP_ROUNDS; round += 1) {
    const removed = await cleanupExpiredProjectChatUploads({ db, deleteStoredObjects, now });
    uploads += removed;
    if (removed === 0) break;
  }

  return {
    sessions: sessions.count,
    resetTokens: resetTokens.count,
    verificationTokens: verificationTokens.count,
    rateLimits,
    guests: guests.deleted,
    guestsSkipped: guests.skipped,
    uploads,
  };
}

async function deleteInactiveGuests({
  db,
  deleteStoredObjects,
  now,
}: {
  db: CleanupDb;
  deleteStoredObjects: (files: ProjectChatStoredAttachmentReference[]) => Promise<void>;
  now: Date;
}) {
  const startedBefore = new Date(now.getTime() - INACTIVE_GUEST_DAYS * 24 * 60 * 60 * 1000);
  const candidates = await db.user.findMany({
    where: {
      isGuest: true,
      createdAt: { lt: startedBefore },
      sessions: { none: { expiresAt: { gt: now } } },
      // Deleting a guest deletes everything it made. Leave it if that would touch a real
      // person's work: a membership in their project, or a real member in the guest's project.
      projectMemberships: { none: { project: { user: { isGuest: false } } } },
      projects: { none: { members: { some: { user: { isGuest: false } } } } },
    },
    orderBy: { createdAt: "asc" },
    take: GUEST_BATCH_SIZE,
    select: { id: true },
  });

  let deleted = 0;
  let skipped = 0;
  for (const { id } of candidates) {
    // Stored files go first: the database rows that point to them cascade with the guest.
    const [attachments, uploads] = await Promise.all([
      db.projectCommentAttachment.findMany({
        where: { OR: [{ userId: id }, { comment: { userId: id } }, { comment: { project: { userId: id } } }] },
        select: STORED_FILE_SELECT,
      }),
      db.projectChatAttachmentUpload.findMany({
        where: { OR: [{ userId: id }, { project: { userId: id } }] },
        select: STORED_FILE_SELECT,
      }),
    ]);
    try {
      await deleteStoredObjects([...attachments, ...uploads]);
    } catch (error) {
      skipped += 1;
      console.error("daily_cleanup_guest_files_failed", { errorName: error instanceof Error ? error.name : "UnknownError" });
      continue;
    }
    const result = await db.user.deleteMany({ where: { id, isGuest: true } });
    deleted += result.count;
  }
  return { deleted, skipped };
}
