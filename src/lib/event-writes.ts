import "server-only";

// Creating, changing and trashing calendar events: the rules of POST /api/events, and of PATCH and
// DELETE /api/events/[id], in one place (#310, #479), so the AI assistant's and connected AI apps'
// changes follow them too. Times are wall-clock values (src/lib/event-time.ts).
import type { Prisma } from "@prisma/client";
import { createActivity } from "@/lib/activity";
import type { Db } from "@/lib/db-client";
import type { EventCreateData, EventUpdateData } from "@/lib/event-fields";
import { prisma } from "@/lib/prisma";
import { canEditProjectContent, getProjectAccess, projectAccessWhere, unauthorizedProjectResponse } from "@/lib/project-access";
import { activityText, refuse, type WriteActor, type WriteResult } from "@/lib/writes";

// The fields' checks have no server imports, so the AI's tools share them (src/lib/event-fields.ts).
export { parseEventCreateBody, parseEventUpdateBody, type EventCreateData, type EventUpdateData } from "@/lib/event-fields";

const EVENT_INCLUDE = { project: { select: { id: true, name: true, color: true } } } satisfies Prisma.EventInclude;

export type CreatedEvent = Prisma.EventGetPayload<{ include: typeof EVENT_INCLUDE }>;

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

/** An event moved to the Trash: what Activity and the calendar feeds need. */
export type TrashedEvent = { id: string; title: string; userId: string; projectId: string | null };

/** Events the person may change: their own and those in their projects, not in the Trash. */
function changeableEventWhere(id: string, userId: string): Prisma.EventWhereInput {
  return { id, deletedAt: null, OR: [{ userId }, { project: projectAccessWhere(userId) }] };
}

/** Replaces an event's fields with `input`, as the event form saves it. A repeating event changes as a whole. */
export async function updateEvent(actor: WriteActor, id: string, input: EventUpdateData, db: Db = prisma): Promise<WriteResult<CreatedEvent>> {
  if (input.projectId) {
    const access = await getProjectAccess(input.projectId, actor.id, db);
    if (!access) return refuse(400, "Invalid project");
    if (!canEditProjectContent(access)) return refuse(403, unauthorizedProjectResponse("edit events").error);
  }

  const existingEvent = await db.event.findFirst({ where: changeableEventWhere(id, actor.id), select: { id: true, projectId: true } });
  if (!existingEvent) return refuse(404, "Event not found");
  if (existingEvent.projectId) {
    const existingAccess = await getProjectAccess(existingEvent.projectId, actor.id, db);
    if (!canEditProjectContent(existingAccess)) return refuse(403, unauthorizedProjectResponse("edit events").error);
  }

  const event = await db.event.update({
    where: { id },
    data: {
      title: input.title,
      description: input.description,
      location: input.location,
      ...input.times,
      recurrence: input.recurrence,
      ...(input.repeatUntil !== undefined ? { repeatUntil: input.repeatUntil } : {}),
      project: input.projectId ? { connect: { id: input.projectId } } : { disconnect: true },
    },
    include: EVENT_INCLUDE,
  });
  return { ok: true, value: event, followUp: { feeds: { userIds: [event.userId], projectIds: [existingEvent.projectId, event.projectId] } } };
}

/** Moves an event to the Trash, where whoever trashed it, or its owner, can restore it. A repeating event goes as a whole. */
export async function trashEvent(actor: WriteActor, id: string, db: Db = prisma): Promise<WriteResult<TrashedEvent>> {
  const existingEvent = await db.event.findFirst({
    where: changeableEventWhere(id, actor.id),
    select: { id: true, title: true, userId: true, projectId: true },
  });
  if (!existingEvent) return refuse(404, "Event not found");

  if (existingEvent.projectId) {
    const existingAccess = await getProjectAccess(existingEvent.projectId, actor.id, db);
    if (!canEditProjectContent(existingAccess)) return refuse(403, unauthorizedProjectResponse("delete events").error);
  }

  const deleted = await db.event.updateMany({
    where: { id, deletedAt: null },
    data: { deletedAt: new Date(), deletedById: actor.id },
  });
  if (deleted.count === 0) return refuse(404, "Event not found");

  await createActivity(
    {
      userId: existingEvent.userId,
      action: "DELETED_ITEM",
      message: activityText(`Deleted event: “${existingEvent.title}”`, actor),
      entityType: "EVENT",
      entityId: existingEvent.id,
      projectId: existingEvent.projectId,
    },
    db,
  );
  return { ok: true, value: existingEvent, followUp: { feeds: { userIds: [existingEvent.userId], projectIds: [existingEvent.projectId] } } };
}
