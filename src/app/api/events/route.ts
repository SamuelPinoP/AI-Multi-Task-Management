import { prisma } from "@/lib/prisma";
import { normalizeRecurrence, isValidRecurrence } from "@/lib/recurrence";
import { NextResponse } from "next/server";
import { Recurrence } from "@prisma/client";

const DEMO_USER_EMAIL = "samuel@example.com";

function parseOptionalDateTime(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") return "INVALID";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "INVALID" : parsed;
}

export async function GET() {
  const user = await prisma.user.findUnique({ where: { email: DEMO_USER_EMAIL }, include: { events: { where: { deletedAt: null }, orderBy: [{ createdAt: "desc" }] } } });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
  return NextResponse.json(user.events.map((event) => ({ ...event, recurrence: normalizeRecurrence(event.recurrence) })));
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) return NextResponse.json({ error: "Title is required" }, { status: 400 });

    const recurrence = normalizeRecurrence(body.recurrence);
    if (body.recurrence && !isValidRecurrence(body.recurrence)) return NextResponse.json({ error: "Invalid recurrence" }, { status: 400 });

    const startTime = parseOptionalDateTime(body.startTime);
    const endTime = parseOptionalDateTime(body.endTime);
    if (startTime === "INVALID" || endTime === "INVALID") return NextResponse.json({ error: "Invalid date/time" }, { status: 400 });
    if (recurrence === Recurrence.NONE && (!startTime || !endTime)) return NextResponse.json({ error: "One-time events require start and end time" }, { status: 400 });
    if (startTime && endTime && endTime <= startTime) return NextResponse.json({ error: "End time must be after start time" }, { status: 400 });

    const user = await prisma.user.findUnique({ where: { email: DEMO_USER_EMAIL } });
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const event = await prisma.event.create({ data: {
      title,
      description: typeof body.description === "string" && body.description.trim() ? body.description.trim() : null,
      location: typeof body.location === "string" && body.location.trim() ? body.location.trim() : null,
      startTime,
      endTime,
      recurrence,
      recurrenceWeekday: typeof body.recurrenceWeekday === "number" ? body.recurrenceWeekday : null,
      recurrenceDayOfMonth: typeof body.recurrenceDayOfMonth === "number" ? body.recurrenceDayOfMonth : null,
      recurrenceStartDate: parseOptionalDateTime(body.recurrenceStartDate) || null,
      recurrenceEndDate: parseOptionalDateTime(body.recurrenceEndDate) || null,
      userId: user.id,
    }});

    return NextResponse.json(event, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to create event" }, { status: 500 });
  }
}
