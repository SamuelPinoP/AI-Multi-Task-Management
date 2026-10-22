import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { calendarFeedPath, newCalendarFeedToken } from "@/lib/calendar-feed";
import { prisma } from "@/lib/prisma";

// The signed-in user's calendar subscription link (SMART-09).

/** The current link, or null when it's off. */
export async function GET() {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const { calendarFeedToken } = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { calendarFeedToken: true } });
  return NextResponse.json({ path: calendarFeedToken ? calendarFeedPath(calendarFeedToken) : null });
}

/** Turns the link on, or replaces it: the old link stops working. */
export async function POST() {
  try {
    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    const token = newCalendarFeedToken();
    await prisma.user.update({ where: { id: user.id }, data: { calendarFeedToken: token } });
    return NextResponse.json({ path: calendarFeedPath(token) }, { status: 201 });
  } catch (error) {
    console.error("POST /api/calendar-feed error:", error);
    return NextResponse.json({ error: "Failed to create the calendar link" }, { status: 500 });
  }
}

/** Turns the link off. */
export async function DELETE() {
  try {
    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    await prisma.user.update({ where: { id: user.id }, data: { calendarFeedToken: null } });
    return NextResponse.json({ path: null });
  } catch (error) {
    console.error("DELETE /api/calendar-feed error:", error);
    return NextResponse.json({ error: "Failed to turn off the calendar link" }, { status: 500 });
  }
}
