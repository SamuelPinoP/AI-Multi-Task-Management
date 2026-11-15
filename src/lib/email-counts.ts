import type { PrismaClient } from "@prisma/client";
import { emailCountHour, last24HoursStart } from "@/lib/usage-core";

/**
 * Counts the emails the app sends, per hour, so the usage page can compare them with the email
 * provider's daily limit (#286). Gmail allows about 500 a day, and nothing else counts them.
 */

type EmailCountDb = Pick<PrismaClient, "emailHourlyCount">;

const DAY_MS = 24 * 60 * 60 * 1000;
/** The usage page also shows this many days' total. The daily cleanup keeps a few days more. */
export const EMAIL_COUNT_SUMMARY_DAYS = 30;

export type EmailOutcome = "sent" | "failed";

/** Adds one email to its hour's count. Never throws: a count that can't be saved mustn't stop the email. */
export async function countEmail(db: EmailCountDb, outcome: EmailOutcome, now = new Date()) {
  const hour = emailCountHour(now);
  try {
    // One statement (INSERT … ON CONFLICT), so two emails in the same new hour can't collide.
    await db.emailHourlyCount.upsert({
      where: { hour },
      create: outcome === "sent" ? { hour, sent: 1 } : { hour, failed: 1 },
      update: outcome === "sent" ? { sent: { increment: 1 } } : { failed: { increment: 1 } },
    });
  } catch (error) {
    console.warn("email_count_failed", { outcome, error: error instanceof Error ? error.name : "UnknownError" });
  }
}

export type RecentEmailCounts = {
  last24Hours: { sent: number; failed: number };
  lastDays: { days: number; sent: number };
};

/** Emails sent and failed in the last 24 hours, and sent in the last EMAIL_COUNT_SUMMARY_DAYS days. */
export async function recentEmailCounts(db: EmailCountDb, now = new Date()): Promise<RecentEmailCounts> {
  const [day, days] = await Promise.all([
    db.emailHourlyCount.aggregate({ where: { hour: { gte: last24HoursStart(now) } }, _sum: { sent: true, failed: true } }),
    db.emailHourlyCount.aggregate({
      where: { hour: { gte: emailCountHour(new Date(now.getTime() - EMAIL_COUNT_SUMMARY_DAYS * DAY_MS)) } },
      _sum: { sent: true },
    }),
  ]);
  return {
    last24Hours: { sent: day._sum.sent ?? 0, failed: day._sum.failed ?? 0 },
    lastDays: { days: EMAIL_COUNT_SUMMARY_DAYS, sent: days._sum.sent ?? 0 },
  };
}
