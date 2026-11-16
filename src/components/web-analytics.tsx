"use client";

import { Analytics } from "@vercel/analytics/next";
import { scrubAnalyticsUrl } from "@/lib/web-analytics-core";

/**
 * Anonymous page view counts with Vercel Web Analytics (#428): no cookies, no IP addresses, and each
 * address sent without its query string or ids. The root layout renders it only on production
 * deployments, and never for the app's admins, so their own visits don't use the free allowance.
 */
export function WebAnalytics() {
  return <Analytics beforeSend={(event) => ({ ...event, url: scrubAnalyticsUrl(event.url) })} />;
}
