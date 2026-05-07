import { prisma } from "@/lib/prisma";
import { normalizeRecurrence, isValidRecurrence } from "@/lib/recurrence";
import { NextResponse } from "next/server";
import { Recurrence } from "@prisma/client";

const DEMO_USER_EMAIL = "samuel@example.com";
const parseDate = (v: unknown) => (typeof v === "string" && v.trim() ? new Date(v) : null);

export async function GET() {
  const user = await prisma.user.findUnique({ where: { email: DEMO_USER_EMAIL }, include: { events: { where: { deletedAt: null }, orderBy: [{ createdAt: "desc" }] } } });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
  return NextResponse.json(user.events.map((e) => ({ ...e, recurrence: normalizeRecurrence(e.recurrence) })));
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) return NextResponse.json({ error: "Title is required" }, { status: 400 });
    if (body.recurrence && !isValidRecurrence(body.recurrence)) return NextResponse.json({ error: "Invalid recurrence" }, { status: 400 });
    const recurrence = normalizeRecurrence(body.recurrence);
    const startTime = parseDate(body.startTime);
    const endTime = parseDate(body.endTime);

    if (recurrence === Recurrence.NONE) {
      if (!startTime || !endTime) return NextResponse.json({ error: "One-time events require start and end time" }, { status: 400 });
      if (endTime <= startTime) return NextResponse.json({ error: "End time must be after start time" }, { status: 400 });
    }

    const recurrenceAnchorDate = parseDate(body.recurrenceAnchorDate) ?? startTime;
    if (recurrence !== Recurrence.NONE && !recurrenceAnchorDate) return NextResponse.json({ error: "Recurring events require an anchor date" }, { status: 400 });

    const user = await prisma.user.findUnique({ where: { email: DEMO_USER_EMAIL } });
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const event = await prisma.event.create({ data: {
      title,
      description: typeof body.description === "string" && body.description.trim() ? body.description.trim() : null,
      location: typeof body.location === "string" && body.location.trim() ? body.location.trim() : null,
      startTime,
      endTime,
      recurrence,
      recurrenceAnchorDate,
      recurrenceWeekday: typeof body.recurrenceWeekday === 'number' ? body.recurrenceWeekday : null,
      recurrenceMonthDay: typeof body.recurrenceMonthDay === 'number' ? body.recurrenceMonthDay : null,
      userId: user.id,
    }});
    return NextResponse.json(event, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Failed to create event" }, { status: 500 });
  }
}
