import "server-only";

// Creating a calendar event: the rules of POST /api/events in one place (#310), so the AI
// assistant's changes follow them too. Times are wall-clock values (src/lib/event-time.ts).
import type { Prisma } from "@prisma/client";
import { createActivity } from "@/lib/activity";
import type { Db } from "@/lib/db-client";
import { parseEventTimes, parseRepeatUntil, type ParsedEventTimes } from "@/lib/event-time";
import { prisma } from "@/lib/prisma";
import { canEditProjectContent, getProjectAccess, unauthorizedProjectResponse } from "@/lib/project-access";
import { isValidRecurrence, normalizeRecurrence, type RecurrenceValue } from "@/lib/recurrence";
import { activityText, refuse, type WriteActor, type WriteResult } from "@/lib/writes";

export type EventCreateData = {
  title: string;
  description: string | null;
  location: string | null;
  times: ParsedEventTimes;
  recurrence: RecurrenceValue;
  repeatUntil: Date | null;
  projectId: string | null;
};

const EVENT_INCLUDE = { project: { select: { id: true, name: true, color: true } } } satisfies Prisma.EventInclude;

export type CreatedEvent = Prisma.EventGetPayload<{ include: typeof EVENT_INCLUDE }>;

function optionalText(value: unknown) {
  return typeof value === "string" ? value.trim() || null : null;
}

/**
 * A new event from the fields the event form sends (`startDate`, `startTime`, `endDate`, `endTime`
 * as `YYYY-MM-DD` and `HH:MM`, `recurrence`, `repeatUntil`…), or the message for a 400.
 */
export function parseEventCreateBody(body: Record<string, unknown>): { data: EventCreateData } | { error: string } {
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) return { error: "Title is required" };

  const times = parseEventTimes({ startDate: body.startDate, startTime: body.startTime, endDate: body.endDate, endTime: body.endTime });
  if (times.error !== undefined) return { error: times.error };

  if (body.recurrence && !isValidRecurrence(body.recurrence)) return { error: "Invalid recurrence" };
  const recurrence = normalizeRecurrence(body.recurrence);
  const repeatUntil = parseRepeatUntil({ startDate: body.startDate, repeatUntil: body.repeatUntil }, recurrence !== "NONE");
  if (repeatUntil.error !== undefined) return { error: repeatUntil.error };

  return {
    data: {
      title,
      description: optionalText(body.description),
      location: optionalText(body.location),
      times: times.value,
      recurrence,
      repeatUntil: repeatUntil.value,
      projectId: optionalText(body.projectId),
    },
  };
}

export async function createEvent(actor: WriteActor, input: EventCreateData, db: Db = prisma): Promise<WriteResult<CreatedEvent>> {
  if (input.projectId) {
    const access = await getProjectAccess(input.projectId, actor.id, db);
    if (!access) return refuse(400, "Invalid project");
    if (!canEditProjectContent(access)) return refuse(403, unauthorizedProjectResponse("create events").error);
  }

  const event = await db.event.create({
    data: {
      title: input.title,
      description: input.description,
      location: input.location,
      ...input.times,
      recurrence: input.recurrence,
      repeatUntil: input.repeatUntil,
      user: { connect: { id: actor.id } },
      project: input.projectId ? { connect: { id: input.projectId } } : undefined,
    },
    include: EVENT_INCLUDE,
  });
  await createActivity(
    {
      userId: actor.id,
      action: "CREATED_EVENT",
      message: activityText(`Created event: “${event.title}”`, actor),
      entityType: "EVENT",
      entityId: event.id,
      projectId: event.projectId,
    },
    db,
  );
  return { ok: true, value: event, followUp: { feeds: { userIds: [actor.id], projectIds: [event.projectId] } } };
}
