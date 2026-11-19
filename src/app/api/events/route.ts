import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/lib/auth";
import { normalizeRecurrence } from "@/lib/recurrence";
import { NextResponse } from "next/server";
import { createEvent, parseEventCreateBody } from "@/lib/event-writes";
import { projectAccessWhere } from "@/lib/project-access";
import { visibleNoteWhere } from "@/lib/note-access";
import { guestLimitResponse } from "@/lib/guest-limits";
import { runFollowUps } from "@/lib/writes";

export async function GET() { /* unchanged */
  try {
    const authUser = await requireApiUser();
    if (!authUser) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    const events = await prisma.event.findMany({ where: { deletedAt: null, OR: [{ userId: authUser.id }, { project: projectAccessWhere(authUser.id) }] }, orderBy: [{ startTime: "asc" }, { createdAt: "desc" }], include: { project: { select: { id: true, name: true, color: true } }, notes: { where: visibleNoteWhere(authUser.id), orderBy: { createdAt: "asc" }, select: { id: true, title: true } } } });
    return NextResponse.json(events.map((event) => ({ ...event, recurrence: normalizeRecurrence(event.recurrence) })));
  } catch (error) {
    console.error("GET /api/events error:", error);
    return NextResponse.json({ error: "Failed to fetch events" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    // The fields first, then the account; the project check is in createEvent, which the AI's changes use too.
    const body = await req.json();
    const parsed = parseEventCreateBody(body && typeof body === "object" ? body : {});
    if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    const guestLimit = await guestLimitResponse(user, "events");
    if (guestLimit) return guestLimit;

    const result = await createEvent(user, parsed.data);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    runFollowUps(user, [result.followUp]);
    return NextResponse.json(result.value, { status: 201 });
  } catch (error) {
    console.error("POST /api/events error:", error);
    return NextResponse.json({ error: "Failed to create event" }, { status: 500 });
  }
}
