import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import type { FreeTierLimit } from "@/lib/free-tier-limits";
import { formatInstant } from "@/lib/user-time";
import { formatUsagePercent, usageLevel, usageLevelText, usagePercent, type UsageLevel } from "@/lib/usage-core";

/** Links inside a sentence are underlined, like the legal pages' (color alone isn't enough). */
export const usageLinkClass = "font-medium text-ink underline underline-offset-4 hover:text-accent";

const barColor: Record<UsageLevel, string> ={ ok: "bg-accent", warning: "bg-warning", danger: "bg-danger" };
const levelTextColor: Record<UsageLevel, string> = { ok: "text-ink", warning: "text-warning", danger: "text-danger" };

/**
 * One limit on the free-tier usage page (#286): what's used, of how much, and the percentage in
 * words, over a bar that turns amber at 70% and red at 90%. The bar repeats the words, so screen
 * readers skip it, and an amber or red bar also says so in words.
 */
export function UsageMeter({
  label,
  used,
  limit,
  format,
  children,
}: {
  label: string;
  used: number;
  limit: number;
  format: (value: number) => string;
  /** Lines under the bar: what's counted, and where the limit comes from. */
  children?: ReactNode;
}) {
  const percent = usagePercent(used, limit);
  const level = usageLevel(percent);
  const levelText = usageLevelText(percent);
  // A sliver stays visible, and a bar past its limit stops at the end.
  const width = percent > 0 ? Math.min(100, Math.max(1, percent)) : 0;

  return (
    <div data-usage-level={level}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <h3 className="text-sm font-medium text-ink">{label}</h3>
        <p className="text-sm tabular-nums text-muted">
          <span className="font-semibold text-ink">{format(used)}</span> of {format(limit)}
          {" · "}
          <span className={cn("font-semibold", levelTextColor[level])}>{formatUsagePercent(percent)}</span>
        </p>
      </div>
      <div aria-hidden="true" className="mt-2 h-2 overflow-hidden rounded-full bg-sunken">
        <div className={cn("h-full rounded-full", barColor[level])} style={{ width: `${width}%` }} />
      </div>
      {levelText ? <p className={cn("mt-1.5 text-xs font-semibold", levelTextColor[level])}>{levelText}</p> : null}
      {children ? <div className="mt-1.5 space-y-1 text-xs text-muted">{children}</div> : null}
    </div>
  );
}

/** "Limit from Cloudflare R2 pricing, checked Nov 15, 2026", linking to where the limit was read. */
export function LimitSource({ limit }: { limit: FreeTierLimit }) {
  const checked = formatInstant(`${limit.checkedOn}T12:00:00Z`, "UTC", { month: "short", day: "numeric", year: "numeric" });
  return (
    <>
      Limit from{" "}
      <a href={limit.source} target="_blank" rel="noreferrer" className={usageLinkClass}>
        {limit.sourceTitle}
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
      , checked {checked}.
    </>
  );
}
