import "server-only";

// Creating, changing and trashing notes: the rules of POST /api/notes, and of PATCH and DELETE
// /api/notes/[id], in one place (#479), so connected AI apps' changes follow them too. Each
// function takes the database to use (Prisma, or a transaction's client so several changes apply
// together) and returns the note or a refusal with its status (src/lib/writes.ts). Guest limits
// stay in the route: AI apps can't connect to a guest's account.
import type { Prisma } from "@prisma/client";
import { createActivity } from "@/lib/activity";
import type { Db } from "@/lib/db-client";
import { prisma } from "@/lib/prisma";
import { canEditProjectContent, getProjectAccess, projectAccessWhere, unauthorizedProjectResponse } from "@/lib/project-access";
import { activityText, refuse, type WriteActor, type WriteResult } from "@/lib/writes";

/** A note's fields, as the note editor saves them. */
export type NoteData = { title: string; content: string | null; projectId: string | null };

const NOTE_INCLUDE = { project: { select: { id: true, name: true, color: true } } } satisfies Prisma.NoteInclude;

/** A note as the note routes return it. */
export type NoteWithProject = Prisma.NoteGetPayload<{ include: typeof NOTE_INCLUDE }>;

/** A note moved to the Trash: what Activity needs. */
export type TrashedNote = { id: string; title: string; userId: string; projectId: string | null };

export const EMPTY_NOTE = "Add a title or note content before saving.";

/** Notes the person may change: their own and those in their projects, not in the Trash. */
function changeableNoteWhere(id: string, userId: string): Prisma.NoteWhereInput {
  return { id, deletedAt: null, OR: [{ userId }, { project: projectAccessWhere(userId) }] };
}

function optionalText(value: unknown) {
  return typeof value === "string" ? value.trim() || null : null;
}

/** A note from the fields the note editor sends (`title`, `content`, `projectId`), or the message for a 400. */
export function parseNoteBody(body: Record<string, unknown>): { data: NoteData } | { error: string } {
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const content = optionalText(body.content);
  if (!title && !content) return { error: EMPTY_NOTE };
  return { data: { title, content, projectId: optionalText(body.projectId) } };
}

/** The note's project, if the person may add to it: refused when it isn't one of theirs, or they can't edit it. */
async function checkProject(projectId: string | null, actor: WriteActor, action: string, db: Db) {
  if (!projectId) return null;
  const access = await getProjectAccess(projectId, actor.id, db);
  if (!access) return refuse(400, "Invalid project");
  if (!canEditProjectContent(access)) return refuse(403, unauthorizedProjectResponse(action).error);
  return null;
}

export async function createNote(actor: WriteActor, input: NoteData, db: Db = prisma): Promise<WriteResult<NoteWithProject>> {
  if (!input.title && !input.content) return refuse(400, EMPTY_NOTE);
  const refused = await checkProject(input.projectId, actor, "create notes", db);
  if (refused) return refused;

  const note = await db.note.create({
    data: { title: input.title, content: input.content, userId: actor.id, projectId: input.projectId },
    include: NOTE_INCLUDE,
  });
  await createActivity(
    {
      userId: actor.id,
      action: "CREATED_NOTE",
      message: activityText(`Created note: “${note.title || note.content?.slice(0, 40) || "Note"}”`, actor),
      entityType: "NOTE",
      entityId: note.id,
      projectId: note.projectId,
    },
    db,
  );
  // Notes aren't in the calendar feeds.
  return { ok: true, value: note, followUp: {} };
}

/** Replaces a note's title, content and project with `input`, as the note editor saves it. */
export async function updateNote(actor: WriteActor, id: string, input: NoteData, db: Db = prisma): Promise<WriteResult<NoteWithProject>> {
  if (!input.title && !input.content) return refuse(400, EMPTY_NOTE);
  const refused = await checkProject(input.projectId, actor, "edit notes", db);
  if (refused) return refused;

  const existingNote = await db.note.findFirst({ where: changeableNoteWhere(id, actor.id), select: { projectId: true } });
  if (!existingNote) return refuse(404, "Note not found");
  if (existingNote.projectId) {
    const existingAccess = await getProjectAccess(existingNote.projectId, actor.id, db);
    if (!canEditProjectContent(existingAccess)) return refuse(403, unauthorizedProjectResponse("edit notes").error);
  }

  const updated = await db.note.updateMany({
    where: { id, deletedAt: null },
    // A note's event must be in its project, so moving the note clears it (SMART-05).
    data: {
      title: input.title,
      content: input.content,
      projectId: input.projectId,
      ...(existingNote.projectId !== input.projectId ? { eventId: null } : {}),
    },
  });
  if (updated.count === 0) return refuse(404, "Note not found");

  const note = await db.note.findUnique({ where: { id }, include: NOTE_INCLUDE });
  if (!note) return refuse(404, "Note not found");
  return { ok: true, value: note, followUp: {} };
}

/** Moves a note to the Trash, where whoever trashed it, or its owner, can restore it. */
export async function trashNote(actor: WriteActor, id: string, db: Db = prisma): Promise<WriteResult<TrashedNote>> {
  const existingNote = await db.note.findFirst({
    where: changeableNoteWhere(id, actor.id),
    select: { id: true, title: true, userId: true, projectId: true },
  });
  if (!existingNote) return refuse(404, "Note not found");

  if (existingNote.projectId) {
    const existingAccess = await getProjectAccess(existingNote.projectId, actor.id, db);
    if (!canEditProjectContent(existingAccess)) return refuse(403, unauthorizedProjectResponse("delete notes").error);
  }

  const deleted = await db.note.updateMany({
    where: { id, deletedAt: null },
    data: { deletedAt: new Date(), deletedById: actor.id },
  });
  if (deleted.count === 0) return refuse(404, "Note not found");

  await createActivity(
    {
      userId: existingNote.userId,
      action: "DELETED_ITEM",
      message: activityText(`Deleted note: “${existingNote.title}”`, actor),
      entityType: "NOTE",
      entityId: existingNote.id,
      projectId: existingNote.projectId,
    },
    db,
  );
  return { ok: true, value: existingNote, followUp: {} };
}
