import type { PrismaClient } from "@prisma/client";
import { CLIENT_ID_PREFIX, USED_CODE_DAYS } from "@/lib/mcp/oauth";
import { cleanupExpiredProjectChatUploads } from "@/lib/project-chat-quota";
import type { ProjectChatStoredAttachmentReference } from "@/lib/project-chat-storage";
import { signInHistoryCutoff } from "@/lib/sign-in-history-core";

/** Guests are deleted this long after they started, once nobody can sign in to them any more. */
export const INACTIVE_GUEST_DAYS = 30;
/** Inbox notifications (SMART-08) are kept this long, read or not. */
export const NOTIFICATION_DAYS = 90;
/** Hourly email counts (#286) are kept this long; the usage page shows the last 30 days. */
export const EMAIL_COUNT_DAYS = 35;
/** The AI assistant's usage log (#307) is kept this long: enough for the caps, debugging and monthly costs. */
export const AGENT_RUN_DAYS = 90;
/** An AI assistant chat nobody opened or wrote in for this long is deleted (#452; Samuel, November 17). */
export const AGENT_CHAT_DAYS = 90;
/** The log of AI apps' tool calls over MCP (#478) is kept this long: who called what, never what was asked or answered. */
export const MCP_TOOL_CALL_DAYS = 30;
/** A disconnected AI app's grant (#477) is deleted this long after it was disconnected. */
export const MCP_REVOKED_GRANT_DAYS = 30;
/**
 * An AI app's registration (#477) is deleted once it is this old and no grant uses it any more: one
 * nobody connected with goes after a month, and one that was connected a month after it was last
 * disconnected, so connecting it again soon after still works.
 */
export const MCP_UNUSED_CLIENT_DAYS = 30;
/**
 * Changes the AI assistant proposed in an answer that was never stored (the person left before it
 * finished) are deleted after this long (#310); they expired after an hour anyway. The others go
 * with their chat.
 */
export const UNLINKED_PROPOSAL_DAYS = 1;
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
  | "notification"
  | "user"
  | "projectCommentAttachment"
  | "projectChatAttachmentUpload"
  | "emailHourlyCount"
  | "signInEvent"
  | "agentRun"
  | "agentChat"
  | "agentProposal"
  | "mcpToolCall"
  | "mcpAuthorizationCode"
  | "mcpRefreshToken"
  | "mcpClient"
  | "mcpGrant"
>;

export type DailyCleanupResult = {
  sessions: number;
  resetTokens: number;
  verificationTokens: number;
  notifications: number;
  rateLimits: number;
  emailCounts: number;
  /** Sign-ins older than SIGN_IN_HISTORY_DAYS. */
  signIns: number;
  /** AI assistant runs older than AGENT_RUN_DAYS. */
  agentRuns: number;
  /** AI assistant chats nobody opened for AGENT_CHAT_DAYS. */
  agentChats: number;
  /** AI assistant proposals whose answer was never stored, after UNLINKED_PROPOSAL_DAYS. */
  agentProposals: number;
  /** AI apps' tool calls over MCP older than MCP_TOOL_CALL_DAYS. */
  mcpToolCalls: number;
  /** Consent codes USED_CODE_DAYS past their expiry. */
  mcpCodes: number;
  /** Expired refresh tokens: apps unused for a month, or a year after they connected. */
  mcpRefreshTokens: number;
  /** App registrations older than MCP_UNUSED_CLIENT_DAYS that no grant uses. */
  mcpClients: number;
  /** Grants disconnected more than MCP_REVOKED_GRANT_DAYS ago. */
  mcpGrants: number;
  guests: number;
  /** Guests skipped because a stored file couldn't be deleted; they are retried the next day. */
  guestsSkipped: number;
  uploads: number;
};

/**
 * Deletes what nobody can use any more (#132):
 * - expired sessions, used or expired password reset tokens, expired email confirmation links
 *   expired rate-limit counters, inbox notifications older than NOTIFICATION_DAYS, hourly
 *   email counts older than EMAIL_COUNT_DAYS, sign-ins older than SIGN_IN_HISTORY_DAYS, AI
 *   assistant runs older than AGENT_RUN_DAYS, AI chats nobody opened for AGENT_CHAT_DAYS, AI
 *   proposals whose answer was never stored, after UNLINKED_PROPOSAL_DAYS, AI apps' MCP tool
 *   calls older than MCP_TOOL_CALL_DAYS, and sign-in's leftovers for AI apps: old consent codes,
 *   expired refresh tokens, registrations nobody connected with, and grants long disconnected;
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
  const notifications = await db.notification.deleteMany({
    where: { createdAt: { lt: new Date(now.getTime() - NOTIFICATION_DAYS * 86_400_000) } },
  });
  // RateLimit.expiresAt is timestamptz; compare in SQL, as src/lib/rate-limit.ts does, so the
  // database's own time zone can't shift the cutoff.
  const rateLimits = await db.$executeRaw`DELETE FROM "RateLimit" WHERE "expiresAt" < now()`;
  const emailCounts = await db.emailHourlyCount.deleteMany({
    where: { hour: { lt: new Date(now.getTime() - EMAIL_COUNT_DAYS * 86_400_000) } },
  });
  const signIns = await db.signInEvent.deleteMany({ where: { createdAt: { lt: signInHistoryCutoff(now) } } });
  const agentRuns = await db.agentRun.deleteMany({
    where: { createdAt: { lt: new Date(now.getTime() - AGENT_RUN_DAYS * 86_400_000) } },
  });
  // Their messages go with them (a cascade).
  const agentChats = await db.agentChat.deleteMany({
    where: { openedAt: { lt: new Date(now.getTime() - AGENT_CHAT_DAYS * 86_400_000) } },
  });
  const agentProposals = await db.agentProposal.deleteMany({
    where: { messageId: null, createdAt: { lt: new Date(now.getTime() - UNLINKED_PROPOSAL_DAYS * 86_400_000) } },
  });
  const mcpToolCalls = await db.mcpToolCall.deleteMany({
    where: { createdAt: { lt: new Date(now.getTime() - MCP_TOOL_CALL_DAYS * 86_400_000) } },
  });
  const mcp = await cleanUpAppSignIns(db, now);
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
    notifications: notifications.count,
    rateLimits,
    emailCounts: emailCounts.count,
    signIns: signIns.count,
    agentRuns: agentRuns.count,
    agentChats: agentChats.count,
    agentProposals: agentProposals.count,
    mcpToolCalls: mcpToolCalls.count,
    ...mcp,
    guests: guests.deleted,
    guestsSkipped: guests.skipped,
    uploads,
  };
}

/** What sign-in for AI apps (#477) leaves behind once nobody can use it. */
async function cleanUpAppSignIns(db: CleanupDb, now: Date) {
  const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);
  // Used codes stay a day, so a second use can still revoke what the first one got.
  const codes = await db.mcpAuthorizationCode.deleteMany({ where: { expiresAt: { lt: daysAgo(USED_CODE_DAYS) } } });
  const refreshTokens = await db.mcpRefreshToken.deleteMany({ where: { expiresAt: { lt: now } } });
  const grants = await db.mcpGrant.deleteMany({ where: { revokedAt: { lt: daysAgo(MCP_REVOKED_GRANT_DAYS) } } });
  // A grant's client ID is either a registration's or a metadata document's address, so registrations
  // have no link to grants: look up the registered ones still in use.
  const inUse = await db.mcpGrant.findMany({
    where: { clientId: { startsWith: CLIENT_ID_PREFIX } },
    select: { clientId: true },
    distinct: ["clientId"],
  });
  const clients = await db.mcpClient.deleteMany({
    where: { createdAt: { lt: daysAgo(MCP_UNUSED_CLIENT_DAYS) }, id: { notIn: inUse.map(({ clientId }) => clientId) } },
  });
  return { mcpCodes: codes.count, mcpRefreshTokens: refreshTokens.count, mcpClients: clients.count, mcpGrants: grants.count };
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
