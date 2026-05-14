import { prisma } from "@/lib/prisma";
import { normalizeRecurrence, isValidRecurrence } from "@/lib/recurrence";
import { NextResponse } from "next/server";
const DEMO_USER_EMAIL = "samuel@example.com";
type RouteContext = { params: Promise<{ id: string }> };

function parseDate(value: unknown, fieldName: string) { if (typeof value !== "string" || !value.trim()) return { error: `${fieldName} is required` }; const parsed = new Date(`${value}T00:00:00`); if (Number.isNaN(parsed.getTime())) return { error: `Invalid ${fieldName.toLowerCase()}` }; return { value: parsed }; }
function parseOptionalDate(value: unknown, fieldName: string) { if (value === null || value === undefined || value === "") return { value: null }; if (typeof value !== "string") return { error: `Invalid ${fieldName.toLowerCase()}` }; const parsed = new Date(`${value}T00:00:00`); if (Number.isNaN(parsed.getTime())) return { error: `Invalid ${fieldName.toLowerCase()}` }; return { value: parsed }; }
function parseOptionalTime(value: unknown, fieldName: string) { if (value === null || value === undefined || value === "") return { value: null }; if (typeof value !== "string" || !/^\d{2}:\d{2}$/.test(value)) return { error: `Invalid ${fieldName.toLowerCase()}` }; const [hours, minutes] = value.split(":").map(Number); return { value: { hours, minutes } }; }
function mergeDateAndTime(date: Date, time: { hours: number; minutes: number } | null) { const merged = new Date(date); if (time) merged.setHours(time.hours, time.minutes, 0, 0); else merged.setHours(0, 0, 0, 0); return merged; }

export async function PATCH(req: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await req.json();
    const projectId = typeof body.projectId === "string" && body.projectId.trim() ? body.projectId : null;
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) return NextResponse.json({ error: "Title is required" }, { status: 400 });

    const startDateResult = parseDate(body.startDate, "Start date"); if (startDateResult.error) return NextResponse.json({ error: startDateResult.error }, { status: 400 });
    const endDateResult = parseOptionalDate(body.endDate, "End date"); if (endDateResult.error) return NextResponse.json({ error: endDateResult.error }, { status: 400 });
    const startTimeResult = parseOptionalTime(body.startTime, "Start time"); if (startTimeResult.error) return NextResponse.json({ error: startTimeResult.error }, { status: 400 });
    const endTimeResult = parseOptionalTime(body.endTime, "End time"); if (endTimeResult.error) return NextResponse.json({ error: endTimeResult.error }, { status: 400 });

    const startDate = startDateResult.value as Date; const endDate = endDateResult.value as Date | null;
    const startTimeParts = startTimeResult.value as { hours: number; minutes: number } | null; const endTimeParts = endTimeResult.value as { hours: number; minutes: number } | null;
    if (endDate && endDate < startDate) return NextResponse.json({ error: "End date cannot be before start date" }, { status: 400 });
    if (endDate && startTimeParts && endTimeParts && endDate.toDateString() === startDate.toDateString()) { const s = startTimeParts.hours*60+startTimeParts.minutes; const e = endTimeParts.hours*60+endTimeParts.minutes; if (e <= s) return NextResponse.json({ error: "End time must be after start time when dates are the same" }, { status: 400 }); }
    if (!isValidRecurrence(body.recurrence)) return NextResponse.json({ error: "Invalid recurrence" }, { status: 400 });

    const description = typeof body.description === "string" ? body.description.trim() : "";
    const location = typeof body.location === "string" ? body.location.trim() : "";
    let projectIdToSave: string | null = null;
    if (projectId) {
      const project = await prisma.project.findFirst({ where: { id: projectId, user: { email: DEMO_USER_EMAIL } } });
      if (!project) return NextResponse.json({ error: "Invalid project" }, { status: 400 });
      projectIdToSave = project.id;
    }
    const updated = await prisma.event.updateMany({ where: { id, deletedAt: null, user: { email: DEMO_USER_EMAIL } }, data: { title, description: description || null, location: location || null, startTime: mergeDateAndTime(startDate, startTimeParts), endTime: endDate ? mergeDateAndTime(endDate, endTimeParts) : null, hasStartTime: Boolean(startTimeParts), hasEndTime: Boolean(endTimeParts), recurrence: normalizeRecurrence(body.recurrence), projectId: projectIdToSave } });
    if (updated.count === 0) return NextResponse.json({ error: "Event not found" }, { status: 404 });
    const event = await prisma.event.findUnique({ where: { id }, include: { project: true } });
    return NextResponse.json(event ? { ...event, recurrence: normalizeRecurrence(event.recurrence) } : null, { status: 200 });
  } catch (error) { console.error("PATCH /api/events/[id] error:", error); return NextResponse.json({ error: "Failed to update event" }, { status: 500 }); }
}

export async function DELETE(_req: Request, context: RouteContext) { /* unchanged */
  try { const { id } = await context.params; if (!id) return NextResponse.json({ error: "Event id is required" }, { status: 400 });
    const deleted = await prisma.event.updateMany({ where: { id, deletedAt: null, user: { email: DEMO_USER_EMAIL } }, data: { deletedAt: new Date() } });
    if (deleted.count === 0) return NextResponse.json({ error: "Event not found" }, { status: 404 });
    return NextResponse.json({ message: "Event moved to trash" }, { status: 200 });
  } catch (error) { console.error("DELETE /api/events/[id] error:", error); return NextResponse.json({ error: "Failed to delete event" }, { status: 500 }); }
}
