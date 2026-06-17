import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/lib/auth";
import { normalizeRecurrence, isValidRecurrence } from "@/lib/recurrence";
import { NextResponse } from "next/server";
import { createActivity } from "@/lib/activity";
import { projectAccessWhere, getProjectAccess, canEditProjectContent, unauthorizedProjectResponse } from "@/lib/project-access";

function parseProjectId(input: unknown): string | null {
  if (input === null || input === undefined) return null;
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  return trimmed || null;
}

function parseDate(value: unknown, fieldName: string) {
  if (typeof value !== "string" || !value.trim()) return { error: `${fieldName} is required` };
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return { error: `Invalid ${fieldName.toLowerCase()}` };
  return { value: parsed };
}

function parseOptionalDate(value: unknown, fieldName: string) {
  if (value === null || value === undefined || value === "") return { value: null };
  if (typeof value !== "string") return { error: `Invalid ${fieldName.toLowerCase()}` };
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return { error: `Invalid ${fieldName.toLowerCase()}` };
  return { value: parsed };
}

function parseOptionalTime(value: unknown, fieldName: string) {
  if (value === null || value === undefined || value === "") return { value: null };
  if (typeof value !== "string" || !/^\d{2}:\d{2}$/.test(value)) return { error: `Invalid ${fieldName.toLowerCase()}` };
  const [hours, minutes] = value.split(":").map(Number);
  return { value: { hours, minutes } };
}

function mergeDateAndTime(date: Date, time: { hours: number; minutes: number } | null) {
  const merged = new Date(date);
  if (time) merged.setHours(time.hours, time.minutes, 0, 0);
  else merged.setHours(0, 0, 0, 0);
  return merged;
}

export async function GET() { /* unchanged */
  try {
    const authUser = await requireApiUser();
    if (!authUser) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    const events = await prisma.event.findMany({ where: { deletedAt: null, OR: [{ userId: authUser.id }, { project: projectAccessWhere(authUser.id) }] }, orderBy: [{ startTime: "asc" }, { createdAt: "desc" }], include: { project: { select: { id: true, name: true, color: true } } } });
    return NextResponse.json(events.map((event) => ({ ...event, recurrence: normalizeRecurrence(event.recurrence) })));
  } catch (error) {
    console.error("GET /api/events error:", error);
    return NextResponse.json({ error: "Failed to fetch events" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) return NextResponse.json({ error: "Title is required" }, { status: 400 });

    const startDateResult = parseDate(body.startDate, "Start date");
    if (startDateResult.error) return NextResponse.json({ error: startDateResult.error }, { status: 400 });
    const endDateResult = parseOptionalDate(body.endDate, "End date");
    if (endDateResult.error) return NextResponse.json({ error: endDateResult.error }, { status: 400 });
    const startTimeResult = parseOptionalTime(body.startTime, "Start time");
    if (startTimeResult.error) return NextResponse.json({ error: startTimeResult.error }, { status: 400 });
    const endTimeResult = parseOptionalTime(body.endTime, "End time");
    if (endTimeResult.error) return NextResponse.json({ error: endTimeResult.error }, { status: 400 });

    const startDate = startDateResult.value as Date;
    const endDate = endDateResult.value as Date | null;
    const startTimeParts = startTimeResult.value as { hours: number; minutes: number } | null;
    const endTimeParts = endTimeResult.value as { hours: number; minutes: number } | null;

    if (endDate && endDate < startDate) return NextResponse.json({ error: "End date cannot be before start date" }, { status: 400 });
    if (endDate && startTimeParts && endTimeParts && endDate.toDateString() === startDate.toDateString()) {
      const startMin = startTimeParts.hours * 60 + startTimeParts.minutes;
      const endMin = endTimeParts.hours * 60 + endTimeParts.minutes;
      if (endMin <= startMin) return NextResponse.json({ error: "End time must be after start time when dates are the same" }, { status: 400 });
    }

    const startAt = mergeDateAndTime(startDate, startTimeParts);
    const endAt = endDate ? mergeDateAndTime(endDate, endTimeParts) : null;

    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    if (body.recurrence && !isValidRecurrence(body.recurrence)) return NextResponse.json({ error: "Invalid recurrence" }, { status: 400 });

    const description = typeof body.description === "string" ? body.description.trim() : "";
    const location = typeof body.location === "string" ? body.location.trim() : "";
    const projectId = parseProjectId(body.projectId);

    if (projectId) {
      const access = await getProjectAccess(projectId, user.id);
      if (!access) return NextResponse.json({ error: "Invalid project" }, { status: 400 });
      if (!canEditProjectContent(access)) return NextResponse.json(unauthorizedProjectResponse("create events"), { status: 403 });
    }

    const event = await prisma.event.create({
      data: {
        title,
        description: description || null,
        location: location || null,
        startTime: startAt,
        endTime: endAt,
        hasStartTime: Boolean(startTimeParts),
        hasEndTime: Boolean(endTimeParts),
        recurrence: normalizeRecurrence(body.recurrence),
        user: { connect: { id: user.id } },
        project: projectId ? { connect: { id: projectId } } : undefined,
      },
      include: { project: { select: { id: true, name: true, color: true } } },
    });
    void createActivity({
      userId: user.id,
      action: "CREATED_EVENT",
      message: `Created event: “${event.title}”`,
      entityType: "EVENT",
      entityId: event.id,
      projectId: event.projectId,
    });

    return NextResponse.json(event, { status: 201 });
  } catch (error) {
    console.error("POST /api/events error:", error);
    return NextResponse.json({ error: "Failed to create event" }, { status: 500 });
  }
}
