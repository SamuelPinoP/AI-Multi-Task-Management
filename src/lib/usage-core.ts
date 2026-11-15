import { parseEmailProvider } from "@/lib/email-config";
import { FREE_TIER_LIMITS, type FreeTierLimit } from "@/lib/free-tier-limits";

/** The free-tier usage page's arithmetic (#286): how full each limit is, and when to warn. */

/** A bar turns amber from this share of its limit... */
export const USAGE_WARNING_PERCENT = 70;
/** ...and red from this one. */
export const USAGE_DANGER_PERCENT = 90;

export type UsageLevel = "ok" | "warning" | "danger";

/** How much of `limit` is used, in percent, past 100 when over. A limit of 0 is full once anything is used. */
export function usagePercent(used: number, limit: number) {
  const safeUsed = Number.isFinite(used) && used > 0 ? used : 0;
  if (!(Number.isFinite(limit) && limit > 0)) return safeUsed > 0 ? 100 : 0;
  return (safeUsed / limit) * 100;
}

export function usageLevel(percent: number): UsageLevel {
  if (percent >= USAGE_DANGER_PERCENT) return "danger";
  if (percent >= USAGE_WARNING_PERCENT) return "warning";
  return "ok";
}

/** The words beside an amber or red bar, so the color is never the only sign. */
export function usageLevelText(percent: number) {
  if (percent >= 100) return "Over the limit";
  if (percent >= USAGE_DANGER_PERCENT) return "Nearly full";
  if (percent >= USAGE_WARNING_PERCENT) return "Getting close";
  return null;
}

/**
 * The percentage as the page writes it: whole numbers rounded down, so a bar never reads "90%"
 * while it's still amber, and "<1%" for a sliver that isn't nothing.
 */
export function formatUsagePercent(percent: number) {
  if (!(percent > 0)) return "0%";
  if (percent < 1) return "<1%";
  return `${Math.floor(percent)}%`;
}

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/** Three significant digits at most: "8.59", "12.3", "123". Whole bytes have no decimals. */
function fractionDigits(value: number, unit: number) {
  if (unit === 0) return 0;
  return value < 10 ? 2 : value < 100 ? 1 : 0;
}

/** Bytes in decimal units, as the providers count them: "8.59 GB", "123 MB", "0 B". */
export function formatBytes(bytes: number) {
  let value = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  let unit = 0;
  // Compare the rounded value, so 999,999 bytes reads "1 MB" rather than "1,000 KB".
  while (unit < BYTE_UNITS.length - 1 && Number(value.toFixed(fractionDigits(value, unit))) >= 1000) {
    value /= 1000;
    unit += 1;
  }
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: fractionDigits(value, unit) }).format(value)} ${BYTE_UNITS[unit]}`;
}

export function formatCount(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

/** A limit's value in its own unit: "10 GB", "1,000,000". */
export function formatLimitValue(limit: Pick<FreeTierLimit, "value" | "unit">) {
  return limit.unit === "bytes" ? formatBytes(limit.value) : formatCount(limit.value);
}

const HOUR_MS = 60 * 60 * 1000;

/** The start of the UTC hour `instant` falls in: emails are counted per hour (EmailHourlyCount). */
export function emailCountHour(instant: Date) {
  return new Date(Math.floor(instant.getTime() / HOUR_MS) * HOUR_MS);
}

/**
 * The first hour that counts as "the last 24 hours": the current hour and the 24 before it. The
 * window may reach up to an hour further back than Gmail's, so it overcounts rather than miss.
 */
export function last24HoursStart(now: Date) {
  return new Date(emailCountHour(now).getTime() - 24 * HOUR_MS);
}

export type BackupSummary = { count: number; bytes: number; newest: Date | null };

/** One page of an S3 listing, as ListObjectsV2 answers. */
export type BackupListPage = {
  Contents?: Array<{ Size?: number; LastModified?: Date }>;
  IsTruncated?: boolean;
  NextContinuationToken?: string;
};

/** 30 backups fit in one page of 1,000 keys; this only stops a listing that never ends. */
export const MAX_BACKUP_LIST_PAGES = 5;

/** The database backups (#195) in the bucket: how many, their bytes, and the newest. */
export async function summarizeBackups(listPage: (token: string | undefined) => Promise<BackupListPage>): Promise<BackupSummary> {
  const summary: BackupSummary = { count: 0, bytes: 0, newest: null };
  let token: string | undefined;
  for (let page = 0; page < MAX_BACKUP_LIST_PAGES; page += 1) {
    const listing = await listPage(token);
    for (const item of listing.Contents ?? []) {
      summary.count += 1;
      summary.bytes += item.Size ?? 0;
      if (item.LastModified && (!summary.newest || item.LastModified > summary.newest)) summary.newest = item.LastModified;
    }
    token = listing.IsTruncated ? listing.NextContinuationToken : undefined;
    if (!token) break;
  }
  return summary;
}

export type EmailSending =
  | { status: "off" }
  /** A provider whose daily limit the page knows. */
  | { status: "limited"; provider: string; limit: FreeTierLimit }
  /** Sending works, but through a server whose limit isn't in FREE_TIER_LIMITS. */
  | { status: "unknown-limit"; provider: string };

/** Which daily email limit applies, from EMAIL_PROVIDER (and SMTP_HOST, which defaults to Gmail). */
export function emailSending(env: Record<string, string | undefined>): EmailSending {
  const provider = parseEmailProvider(env.EMAIL_PROVIDER);
  if (provider === "disabled" || provider === "invalid") return { status: "off" };
  if (provider === "brevo") return { status: "limited", provider: "Brevo", limit: FREE_TIER_LIMITS.brevoDaily };
  if (provider === "resend") return { status: "limited", provider: "Resend", limit: FREE_TIER_LIMITS.resendDaily };
  const host = env.SMTP_HOST?.trim().toLowerCase() || "smtp.gmail.com";
  return host === "smtp.gmail.com"
    ? { status: "limited", provider: "Gmail", limit: FREE_TIER_LIMITS.gmailDaily }
    : { status: "unknown-limit", provider: host };
}
