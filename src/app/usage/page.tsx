import { Database, ExternalLink, HardDrive, LayoutDashboard, Mail, Users } from "lucide-react";
import type { ReactNode } from "react";
import { uiButtonClass, uiCardClass } from "@/components/ui";
import { LimitSource, UsageMeter } from "@/components/usage-meter";
import { requireAppAdminPage } from "@/lib/app-admin";
import { cn } from "@/lib/cn";
import { FREE_TIER_LIMITS, USAGE_DASHBOARDS, type FreeTierLimit } from "@/lib/free-tier-limits";
import { getUsageReport } from "@/lib/usage";
import { formatBytes, formatCount, formatLimitValue } from "@/lib/usage-core";
import { formatInstant } from "@/lib/user-time";
import { getUserTimeZone } from "@/lib/user-time-server";

function Card({ id, icon, title, children }: { id: string; icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className={uiCardClass}>
      <h2 id={id} className="flex items-center gap-2 text-card">
        {icon}
        {title}
      </h2>
      {children}
    </section>
  );
}

const iconClass = "h-4 w-4 shrink-0 text-muted";

/** A provider whose numbers only its own dashboard has, with the free limits to compare them with. */
function DashboardRow({ name, href, limits }: { name: string; href: string; limits: FreeTierLimit[] }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink">{name}</p>
        <ul className="mt-0.5 text-xs text-muted">
          {limits.map((limit) => (
            <li key={limit.label}>
              {formatLimitValue(limit)} {limit.label}
            </li>
          ))}
        </ul>
      </div>
      <a href={href} target="_blank" rel="noreferrer" className={cn(uiButtonClass, "gap-1.5 px-3 py-1.5")}>
        Open {name}
        <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
    </li>
  );
}

/**
 * The free-tier usage page (#286): how close AI Multi is to each free limit, so a new feature or
 * a busy month never turns into downtime or a bill. Only the accounts in ADMIN_EMAILS can open
 * it; everyone else gets a 404. It measures when it opens and never polls.
 */
export default async function UsagePage() {
  await requireAppAdminPage();
  const [report, timeZone] = await Promise.all([getUsageReport(), getUserTimeZone()]);
  const { storage, email, totals } = report;
  const measuredAt = formatInstant(report.measuredAt, timeZone, { hour: "numeric", minute: "2-digit" });

  return (
    <div className="mx-auto grid w-full max-w-3xl grid-cols-1 gap-5 px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
      <header>
        <h1 className="text-title">Free-tier usage</h1>
        <p className="mt-0.5 text-sm text-muted">
          How close AI Multi is to each free limit, measured at {measuredAt}. Only the accounts in ADMIN_EMAILS can see this page.
        </p>
      </header>

      <Card id="usage-storage" icon={<HardDrive aria-hidden="true" className={iconClass} />} title="File storage">
        {storage.status === "r2" ? (
          <div className="mt-4 space-y-5">
            <UsageMeter label="Chat attachments" used={storage.attachmentBytes} limit={storage.attachmentCapBytes} format={formatBytes}>
              <p>
                Uploads stop at the app&apos;s own cap (PROJECT_CHAT_S3_QUOTA_BYTES), which stays under R2&apos;s free{" "}
                {formatLimitValue(FREE_TIER_LIMITS.r2Storage)}.
              </p>
            </UsageMeter>
            <UsageMeter
              label="Everything in R2"
              used={storage.attachmentBytes + (storage.backups?.bytes ?? 0)}
              limit={FREE_TIER_LIMITS.r2Storage.value}
              format={formatBytes}
            >
              {storage.backups ? (
                <p>
                  Chat attachments plus {formatCount(storage.backups.count)} database{" "}
                  {storage.backups.count === 1 ? "backup" : "backups"} ({formatBytes(storage.backups.bytes)})
                  {storage.backups.newest
                    ? `, the newest from ${formatInstant(storage.backups.newest, timeZone, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
                    : ""}
                  .
                </p>
              ) : (
                <p className="font-medium text-warning">The backups couldn&apos;t be listed, so this leaves them out.</p>
              )}
              <p>
                <LimitSource limit={FREE_TIER_LIMITS.r2Storage} />
              </p>
            </UsageMeter>
          </div>
        ) : (
          <p className="mt-1 text-sm text-muted">
            No R2 bucket is set up here (AWS_S3_BUCKET_NAME), so chat files are stored with{" "}
            {storage.providers.map((provider) => `"${provider}"`).join(" and ")}, and nothing counts toward R2.
          </p>
        )}
      </Card>

      <Card id="usage-database" icon={<Database aria-hidden="true" className={iconClass} />} title="Database">
        <div className="mt-4">
          <UsageMeter label="Database size" used={report.databaseBytes} limit={FREE_TIER_LIMITS.neonStorage.value} format={formatBytes}>
            <p>What Postgres reports for this database. Past the limit, Neon refuses changes that would make it bigger.</p>
            <p>
              <LimitSource limit={FREE_TIER_LIMITS.neonStorage} />
            </p>
          </UsageMeter>
        </div>
      </Card>

      <Card id="usage-email" icon={<Mail aria-hidden="true" className={iconClass} />} title="Email">
        {email.sending.status === "limited" ? (
          <div className="mt-4">
            <UsageMeter label="Emails in the last 24 hours" used={email.counts.last24Hours.sent} limit={email.sending.limit.value} format={formatCount}>
              <p>
                Sent through {email.sending.provider}. {formatCount(email.counts.lastDays.sent)} in the last {email.counts.lastDays.days} days.
              </p>
              {email.counts.last24Hours.failed > 0 ? (
                <p className="font-medium text-warning">
                  {formatCount(email.counts.last24Hours.failed)} couldn&apos;t be sent in the same hours. Check the email settings
                  and the server logs.
                </p>
              ) : null}
              <p>
                <LimitSource limit={email.sending.limit} />
              </p>
            </UsageMeter>
          </div>
        ) : email.sending.status === "unknown-limit" ? (
          <p className="mt-1 text-sm text-muted">
            {formatCount(email.counts.last24Hours.sent)} sent in the last 24 hours through {email.sending.provider}, whose daily limit
            isn&apos;t listed here.
          </p>
        ) : (
          <p className="mt-1 text-sm text-muted">Email sending is off here (EMAIL_PROVIDER), so there&apos;s no daily limit to watch.</p>
        )}
      </Card>

      <Card id="usage-totals" icon={<Users aria-hidden="true" className={iconClass} />} title="For context">
        <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            { label: "Accounts", value: totals.accounts },
            { label: "Guest workspaces", value: totals.guests },
            { label: "Projects", value: totals.projects },
            { label: "Chat attachments", value: totals.attachments },
          ].map(({ label, value }) => (
            <div key={label} className="min-w-0">
              <dt className="text-xs text-muted">{label}</dt>
              <dd className="text-xl font-semibold tabular-nums text-ink">{formatCount(value)}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card id="usage-elsewhere" icon={<LayoutDashboard aria-hidden="true" className={iconClass} />} title="On the providers' dashboards">
        <p className="mt-1 text-sm text-muted">The app can&apos;t read these on free plans. Compare them with the free limits below.</p>
        <ul className="mt-4 divide-y divide-line">
          <DashboardRow
            name="Vercel"
            href={USAGE_DASHBOARDS.vercel}
            limits={[FREE_TIER_LIMITS.vercelFunctionInvocations, FREE_TIER_LIMITS.vercelActiveCpu, FREE_TIER_LIMITS.vercelFastDataTransfer]}
          />
          <DashboardRow name="Neon" href={USAGE_DASHBOARDS.neon} limits={[FREE_TIER_LIMITS.neonCompute]} />
          <DashboardRow
            name="Cloudflare R2"
            href={USAGE_DASHBOARDS.r2}
            limits={[FREE_TIER_LIMITS.r2ClassAOperations, FREE_TIER_LIMITS.r2ClassBOperations]}
          />
        </ul>
      </Card>

      <p className="text-xs text-muted">
        Bars turn amber at 70% of a limit and red at 90%. Each limit, with the day it was checked and its source, is in{" "}
        <code className="whitespace-nowrap">src/lib/free-tier-limits.ts</code>.
      </p>
    </div>
  );
}
