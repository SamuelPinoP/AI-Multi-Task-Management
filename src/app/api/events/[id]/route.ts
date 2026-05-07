import { prisma } from "@/lib/prisma";
import { normalizeRecurrence, isValidRecurrence } from "@/lib/recurrence";
import { NextResponse } from "next/server";
import { Recurrence } from "@prisma/client";

const DEMO_USER_EMAIL = "samuel@example.com";
type RouteContext = { params: Promise<{ id: string }> };
const parseDate = (v: unknown) => (typeof v === "string" && v.trim() ? new Date(v) : null);

export async function PATCH(req: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = await req.json();
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) return NextResponse.json({ error: "Title is required" }, { status: 400 });
  if (!isValidRecurrence(body.recurrence)) return NextResponse.json({ error: "Invalid recurrence" }, { status: 400 });

  const recurrence = normalizeRecurrence(body.recurrence);
  const startTime = parseDate(body.startTime);
  const endTime = parseDate(body.endTime);
  if (recurrence === Recurrence.NONE) {
    if (!startTime || !endTime) return NextResponse.json({ error: "One-time events require start and end time" }, { status: 400 });
    if (endTime <= startTime) return NextResponse.json({ error: "End time must be after start time" }, { status: 400 });
  }

  const recurrenceAnchorDate = parseDate(body.recurrenceAnchorDate) ?? startTime;
  if (recurrence !== Recurrence.NONE && !recurrenceAnchorDate) return NextResponse.json({ error: "Recurring events require an anchor date" }, { status: 400 });

  const updated = await prisma.event.updateMany({ where: { id, deletedAt: null, user: { email: DEMO_USER_EMAIL } }, data: {
    title,
    description: typeof body.description === "string" && body.description.trim() ? body.description.trim() : null,
    location: typeof body.location === "string" && body.location.trim() ? body.location.trim() : null,
    startTime,
    endTime,
    recurrence,
    recurrenceAnchorDate,
    recurrenceWeekday: typeof body.recurrenceWeekday === 'number' ? body.recurrenceWeekday : null,
    recurrenceMonthDay: typeof body.recurrenceMonthDay === 'number' ? body.recurrenceMonthDay : null,
  } });
  if (!updated.count) return NextResponse.json({ error: "Event not found" }, { status: 404 });
  const event = await prisma.event.findUnique({ where: { id } });
  return NextResponse.json(event ? { ...event, recurrence: normalizeRecurrence(event.recurrence) } : null);
}

export async function DELETE(_req: Request, context: RouteContext) {
  const { id } = await context.params;
  const deleted = await prisma.event.updateMany({ where: { id, deletedAt: null, user: { email: DEMO_USER_EMAIL } }, data: { deletedAt: new Date() } });
  if (!deleted.count) return NextResponse.json({ error: "Event not found" }, { status: 404 });
  return NextResponse.json({ message: "Event moved to trash" });
}
