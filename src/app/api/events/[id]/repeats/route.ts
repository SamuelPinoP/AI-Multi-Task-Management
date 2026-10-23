import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { parseRepeatUntil } from "@/lib/event-time";
import { prisma } from "@/lib/prisma";
import { canEditProjectContent, getProjectAccess, projectAccessWhere, unauthorizedProjectResponse } from "@/lib/project-access";
import { normalizeRecurrence, repeatsOnDay, storedDayKey } from "@/lib/recurrence";

type RouteContext = { params: Promise<{ id: string }> };

const CHANGES = ["skipDate", "restoreDate", "repeatUntil"] as const;
/** Years of deleted days; keeps one row from growing without bound. */
const MAX_SKIPPED_DATES = 500;

/** A real `YYYY-MM-DD` day as a stored date (midnight UTC), or null. */
function parseDay(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || storedDayKey(date) !== value ? null : date;
}

/**
 * Changes which days a repeating event happens on, leaving everything else
 * as it is (CAL-03). The body holds exactly one of:
 * - `skipDate`: delete that day only. It must be a day the series repeats on.
 * - `restoreDate`: bring a deleted day back (Undo).
 * - `repeatUntil`: end the series after that day ("this and following days"),
 *   or null to keep repeating (Undo). It can't be before the first day.
 */
export async function PATCH(req: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    const { id } = await context.params;
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const changes = body && typeof body === "object" ? CHANGES.filter((key) => key in body) : [];
    if (!body || changes.length !== 1) {
      return NextResponse.json({ error: "Send one of skipDate, restoreDate or repeatUntil" }, { status: 400 });
    }

    const existing = await prisma.event.findFirst({
      where: { id, deletedAt: null, OR: [{ userId: user.id }, { project: projectAccessWhere(user.id) }] },
      select: { id: true, projectId: true, startTime: true, endTime: true, recurrence: true, repeatUntil: true, skippedDates: true },
    });
    if (!existing) return NextResponse.json({ error: "Event not found" }, { status: 404 });
    if (existing.projectId) {
      const access = await getProjectAccess(existing.projectId, user.id);
      if (!canEditProjectContent(access)) return NextResponse.json(unauthorizedProjectResponse("edit events"), { status: 403 });
    }
    if (normalizeRecurrence(existing.recurrence) === "NONE") {
      return NextResponse.json({ error: "This event doesn't repeat" }, { status: 400 });
    }

    const skipped = existing.skippedDates.map(storedDayKey);
    let data: { skippedDates: { push: Date } | Date[] } | { repeatUntil: Date | null };

    if (changes[0] === "repeatUntil") {
      const until = parseRepeatUntil({ startDate: storedDayKey(existing.startTime), repeatUntil: body.repeatUntil }, true);
      if (until.error !== undefined) return NextResponse.json({ error: until.error }, { status: 400 });
      data = { repeatUntil: until.value };
    } else {
      const day = parseDay(body[changes[0]]);
      if (!day) return NextResponse.json({ error: "Invalid date" }, { status: 400 });
      const key = storedDayKey(day);

      if (changes[0] === "restoreDate") {
        data = { skippedDates: existing.skippedDates.filter((date) => storedDayKey(date) !== key) };
      } else {
        const series = {
          id: existing.id,
          startTime: existing.startTime.toISOString(),
          endTime: existing.endTime?.toISOString() ?? null,
          recurrence: normalizeRecurrence(existing.recurrence),
          repeatUntil: existing.repeatUntil,
        };
        if (!repeatsOnDay(series, key)) return NextResponse.json({ error: "The event doesn't happen on that day" }, { status: 400 });
        if (skipped.length >= MAX_SKIPPED_DATES) {
          return NextResponse.json({ error: "Too many deleted days; end the series instead" }, { status: 400 });
        }
        // An atomic append, so two days deleted at once both stick. Deleting a deleted day again changes nothing.
        data = { skippedDates: skipped.includes(key) ? existing.skippedDates : { push: day } };
      }
    }

    const event = await prisma.event.update({
      where: { id },
      data,
      include: { project: { select: { id: true, name: true, color: true } } },
    });
    return NextResponse.json({ ...event, recurrence: normalizeRecurrence(event.recurrence) });
  } catch (error) {
    console.error("PATCH /api/events/[id]/repeats error:", error);
    return NextResponse.json({ error: "Failed to update the event" }, { status: 500 });
  }
}
