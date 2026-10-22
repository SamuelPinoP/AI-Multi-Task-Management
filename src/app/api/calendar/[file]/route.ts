import { NextResponse } from "next/server";
import { calendarFeedFor } from "@/lib/calendar-feed";
import { tokenFromFeedFile } from "@/lib/calendar-feed-core";
import { prisma } from "@/lib/prisma";

type RouteContext = { params: Promise<{ file: string }> };

/**
 * The calendar subscription feed (SMART-09). Calendar apps fetch it without
 * signing in, so the secret token in the link is the key.
 */
export async function GET(req: Request, context: RouteContext) {
  try {
    const token = tokenFromFeedFile((await context.params).file);
    // Malformed links never reach the database.
    const user = token
      ? await prisma.user.findUnique({ where: { calendarFeedToken: token }, select: { id: true } })
      : null;
    if (!user) return NextResponse.json({ error: "Calendar not found" }, { status: 404 });

    const appUrl = (process.env.APP_BASE_URL?.trim() || new URL(req.url).origin).replace(/\/+$/, "");
    return new NextResponse(await calendarFeedFor(user.id, appUrl), {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'inline; filename="ai-multi.ics"',
        // Private data behind a secret link: no shared caches, and keep it out of search results.
        "Cache-Control": "private, max-age=300",
        "X-Robots-Tag": "noindex",
      },
    });
  } catch (error) {
    console.error("GET /api/calendar/[file] error:", error);
    return NextResponse.json({ error: "Failed to build the calendar" }, { status: 500 });
  }
}
