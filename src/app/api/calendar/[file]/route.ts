import { serveCalendarFeed } from "@/lib/calendar-feed-store";

type RouteContext = { params: Promise<{ file: string }> };

/**
 * The calendar subscription feed (SMART-09). Calendar apps fetch it without
 * signing in, so the secret token in the link is the key. They fetch on their
 * own schedule, day and night, so a stored copy is served without touching
 * the database (CU-01, #497; see calendar-feed-store-core.ts).
 */
export async function GET(req: Request, context: RouteContext) {
  const appUrl = (process.env.APP_BASE_URL?.trim() || new URL(req.url).origin).replace(/\/+$/, "");
  return serveCalendarFeed((await context.params).file, appUrl);
}
