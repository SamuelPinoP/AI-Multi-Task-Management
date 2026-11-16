/**
 * The free-tier limits the usage page (#286) measures against, in one place so they're easy to
 * re-check: each one says when it was last checked against its source, and where that is. Byte
 * limits use decimal units (1 GB is 1,000,000,000 bytes), the smaller reading of a provider's "GB".
 */
export type FreeTierLimit = {
  /** The plan that grants it. */
  plan: string;
  value: number;
  unit: "bytes" | "count";
  /** What it limits, written to follow the value: "10 GB of storage". */
  label: string;
  /** The day it was last checked against `source`, as YYYY-MM-DD. */
  checkedOn: string;
  source: string;
  /** The source's name, as its link reads. */
  sourceTitle: string;
};

export const FREE_TIER_LIMITS = {
  r2Storage: {
    plan: "Cloudflare R2",
    value: 10 * 1000 ** 3,
    unit: "bytes",
    label: "of storage",
    checkedOn: "2026-11-15",
    source: "https://developers.cloudflare.com/r2/pricing/",
    sourceTitle: "Cloudflare R2 pricing",
  },
  r2ClassAOperations: {
    plan: "Cloudflare R2",
    value: 1_000_000,
    unit: "count",
    label: "Class A operations a month (uploads, lists)",
    checkedOn: "2026-11-15",
    source: "https://developers.cloudflare.com/r2/pricing/",
    sourceTitle: "Cloudflare R2 pricing",
  },
  r2ClassBOperations: {
    plan: "Cloudflare R2",
    value: 10_000_000,
    unit: "count",
    label: "Class B operations a month (downloads)",
    checkedOn: "2026-11-15",
    source: "https://developers.cloudflare.com/r2/pricing/",
    sourceTitle: "Cloudflare R2 pricing",
  },
  neonStorage: {
    plan: "Neon Free",
    value: 1000 ** 3,
    unit: "bytes",
    label: "of storage per project",
    checkedOn: "2026-11-15",
    source: "https://neon.com/faqs/free-plan-limits-and-quotas",
    sourceTitle: "Neon's Free plan limits",
  },
  neonCompute: {
    plan: "Neon Free",
    value: 100,
    unit: "count",
    label: "CU-hours of compute a month",
    checkedOn: "2026-11-15",
    source: "https://neon.com/faqs/free-plan-limits-and-quotas",
    sourceTitle: "Neon's Free plan limits",
  },
  gmailDaily: {
    plan: "Gmail",
    value: 500,
    unit: "count",
    label: "emails a day",
    checkedOn: "2026-11-15",
    source: "https://support.google.com/mail/answer/22839",
    sourceTitle: "Gmail's sending limits",
  },
  brevoDaily: {
    plan: "Brevo Free",
    value: 300,
    unit: "count",
    label: "emails a day",
    checkedOn: "2026-11-15",
    source: "https://help.brevo.com/hc/en-us/articles/208580669-FAQs-What-are-the-limits-of-the-Free-plan",
    sourceTitle: "Brevo's Free plan limits",
  },
  resendDaily: {
    plan: "Resend Free",
    value: 100,
    unit: "count",
    label: "emails a day",
    checkedOn: "2026-11-15",
    source: "https://resend.com/docs/knowledge-base/account-quotas-and-limits",
    sourceTitle: "Resend's account quotas",
  },
  vercelFunctionInvocations: {
    plan: "Vercel Hobby",
    value: 1_000_000,
    unit: "count",
    label: "function invocations a month",
    checkedOn: "2026-11-15",
    source: "https://vercel.com/docs/plans/hobby",
    sourceTitle: "Vercel's Hobby plan",
  },
  vercelActiveCpu: {
    plan: "Vercel Hobby",
    value: 4,
    unit: "count",
    label: "hours of active CPU a month",
    checkedOn: "2026-11-15",
    source: "https://vercel.com/docs/plans/hobby",
    sourceTitle: "Vercel's Hobby plan",
  },
  vercelFastDataTransfer: {
    plan: "Vercel Hobby",
    value: 100 * 1000 ** 3,
    unit: "bytes",
    label: "of fast data transfer a month",
    checkedOn: "2026-11-15",
    source: "https://vercel.com/docs/plans/hobby",
    sourceTitle: "Vercel's Hobby plan",
  },
  /** Shared by every project in the account. At the limit Hobby isn't billed: counting pauses until the next month. */
  vercelWebAnalyticsEvents: {
    plan: "Vercel Hobby",
    value: 50_000,
    unit: "count",
    label: "page views a month; past it, counting pauses and nothing is billed",
    checkedOn: "2026-11-15",
    source: "https://vercel.com/docs/analytics/limits-and-pricing",
    sourceTitle: "Vercel Web Analytics pricing",
  },
} as const satisfies Record<string, FreeTierLimit>;

/**
 * Where to read what the app can't measure itself. These links open the signed-in person's own
 * account, so no team or project name is written here.
 */
export const USAGE_DASHBOARDS = {
  vercel: "https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fusage&title=Go+to+Usage",
  /** Vercel asks which project, then opens its Web Analytics page (#428). */
  vercelAnalytics: "https://vercel.com/d?to=%2F%5Bteam%5D%2F%5Bproject%5D%2Fanalytics&title=Go+to+Web+Analytics",
  neon: "https://console.neon.tech/app/projects",
  r2: "https://dash.cloudflare.com/?to=/:account/r2/overview",
} as const;
