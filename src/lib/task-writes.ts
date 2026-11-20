import "server-only";

// Creating, changing and trashing tasks: the rules of POST /api/tasks, and of PATCH and DELETE
// /api/tasks/[id], in one place (#310), so the AI assistant's changes follow them too. Each
// function takes the database to use (Prisma, or a transaction's client so several changes apply
// together) and returns the task or a refusal with its status (src/lib/writes.ts). The routes
// check the request body first (src/lib/schemas/task.ts) and run the follow-ups.
import type { Prisma } from "@prisma/client";
import { createActivity } from "@/lib/activity";
import type { Db } from "@/lib/db-client";
import { dropLabelsOutsideScope, labelScopeFor, resolveTaskLabelIds, setTaskLabels } from "@/lib/labels-server";
import { visibleNoteWhere } from "@/lib/note-access";
import { prisma } from "@/lib/prisma";
import { canEditProjectContent, getProjectAccess, projectAccessWhere, unauthorizedProjectResponse } from "@/lib/project-access";
import type { TaskCreateData, TaskUpdateData } from "@/lib/schemas/task";
import { nextCompletedAt } from "@/lib/task-completion";
import { loadHistoryStates, recordTaskChanges, recordTaskCreated } from "@/lib/task-history-server";
import { taskInclude, visibleTaskWhere } from "@/lib/task-include";
import { activityText, refuse, type WriteActor, type WriteResult } from "@/lib/writes";

/** A task as the task routes return it. */
export type TaskWithDetails = Prisma.TaskGetPayload<{ include: ReturnType<typeof taskInclude> }>;

/** A task moved to the Trash: what Activity and the calendar feeds need. */
export type TrashedTask = { id: string; title: string; userId: string; projectId: string | null };

/** Tasks the person may change: their own and those in their projects, not in the Trash. */
function changeableTaskWhere(id: string, userId: string): Prisma.TaskWhereInput {
  return { id, deletedAt: null, OR: [{ userId }, { project: projectAccessWhere(userId) }] };
}

export async function createTask(actor: WriteActor, input: TaskCreateData, db: Db = prisma): Promise<WriteResult<TaskWithDetails>> {
  const { parentId, noteId, assigneeId } = input;
  let projectId = input.projectId;

  // A subtask (SMART-02) goes in its parent's project, one level deep.
  if (parentId) {
    const parent = await db.task.findFirst({
      where: { id: parentId, ...visibleTaskWhere(actor.id) },
      select: { projectId: true, parentId: true },
    });
    if (!parent) return refuse(400, "Invalid parent task");
    if (parent.parentId) return refuse(400, "Subtasks can't have their own subtasks");
    projectId = parent.projectId;
  }

  // A task made from a note (SMART-05) goes in the note's project.
  if (noteId) {
    const note = await db.note.findFirst({ where: { id: noteId, ...visibleNoteWhere(actor.id) }, select: { projectId: true } });
    if (!note) return refuse(400, "Invalid note");
    // A subtask keeps its parent's project.
    if (!parentId) projectId = note.projectId;
  }

  if (projectId) {
    const access = await getProjectAccess(projectId, actor.id, db);
    if (!access) return refuse(400, "Invalid project");
    if (!canEditProjectContent(access)) return refuse(403, unauthorizedProjectResponse("create tasks").error);
  }

  if (assigneeId) {
    if (!projectId) return refuse(400, "Assignee requires a project");
    const member = await db.projectMember.findFirst({ where: { id: assigneeId, projectId } });
    if (!member) return refuse(400, "Invalid assignee");
  }

  // Labels (#276) come from the task's project, or from the creator's personal labels.
  const labels = await resolveTaskLabelIds(input.labelIds, projectId ? { projectId } : { userId: actor.id }, db);
  if (labels.error) return refuse(400, labels.error);

  const status = input.status ?? "TODO";
  const task = await db.task.create({
    data: {
      title: input.title,
      description: input.description || null,
      status,
      // No priority unless one is picked (#361).
      priority: input.priority ?? "NONE",
      dueDate: input.dueDate,
      completedAt: status === "DONE" ? new Date() : null,
      recurrence: input.recurrence ?? "NONE",
      userId: actor.id,
      projectId,
      assigneeId,
      parentId,
      noteId,
      labels: labels.ids?.length ? { create: labels.ids.map((labelId) => ({ labelId })) } : undefined,
    },
    include: taskInclude(actor.id),
  });

  await recordTaskCreated(task.id, actor.id, db);
  const done = status === "DONE";
  await createActivity(
    {
      userId: actor.id,
      action: done ? "COMPLETED_TASK" : "CREATED_TASK",
      message: activityText(`${done ? "Completed task" : "Created task"}: “${task.title}”`, actor),
      entityType: "TASK",
      entityId: task.id,
      projectId: task.projectId,
    },
    db,
  );
  return {
    ok: true,
    value: task,
    // The assignee hears about it in their inbox (SMART-08).
    followUp: { feeds: { userIds: [actor.id], projectIds: [task.projectId] }, assigned: task.assigneeId ? task : undefined },
  };
}

/** Replaces a task's fields with `input`, as the task's edit form saves it. */
export async function updateTask(actor: WriteActor, id: string, input: TaskUpdateData, db: Db = prisma): Promise<WriteResult<TaskWithDetails>> {
  let projectId = input.projectId;
  let assigneeId = input.assigneeId;

  // A subtask always stays in its parent's project (SMART-02).
  const subtask = await db.task.findFirst({
    where: { id, parentId: { not: null } },
    select: { parent: { select: { projectId: true } } },
  });
  if (subtask?.parent) projectId = subtask.parent.projectId;

  if (projectId) {
    const access = await getProjectAccess(projectId, actor.id, db);
    if (!access) return refuse(400, "Invalid project");
    if (!canEditProjectContent(access)) return refuse(403, unauthorizedProjectResponse("edit tasks").error);
  }

  if (assigneeId && !projectId) return refuse(400, "Assignee requires a project");
  if (assigneeId && projectId) {
    const member = await db.projectMember.findFirst({ where: { id: assigneeId, projectId } });
    if (!member) return refuse(400, "Invalid assignee");
  }
  if (!projectId) assigneeId = null;

  const existingTask = await db.task.findFirst({
    where: changeableTaskWhere(id, actor.id),
    select: { id: true, status: true, title: true, userId: true, projectId: true, assigneeId: true },
  });
  if (!existingTask) return refuse(404, "Task not found");

  if (existingTask.projectId) {
    const existingAccess = await getProjectAccess(existingTask.projectId, actor.id, db);
    if (!canEditProjectContent(existingAccess)) return refuse(403, unauthorizedProjectResponse("edit tasks").error);
  }

  // Labels (#276): `labelIds` replaces the set; leaving it out keeps the labels that still fit.
  const labelScope = labelScopeFor({ projectId, userId: existingTask.userId });
  const labels = await resolveTaskLabelIds(input.labelIds, labelScope, db);
  if (labels.error) return refuse(400, labels.error);

  // The history (#279) compares the task before and after this change.
  const before = await loadHistoryStates([id], db);

  const updated = await db.task.updateMany({
    where: { id, deletedAt: null },
    data: {
      title: input.title,
      description: input.description || null,
      status: input.status,
      priority: input.priority,
      dueDate: input.dueDate,
      completedAt: nextCompletedAt(existingTask.status, input.status),
      recurrence: input.recurrence,
      projectId,
      assigneeId,
    },
  });
  if (updated.count === 0) return refuse(404, "Task not found");

  // Moving a task to another project moves its subtasks too; their assignees belonged to the old one.
  if (existingTask.projectId !== projectId) {
    await db.task.updateMany({ where: { parentId: id }, data: { projectId, assigneeId: null } });
    // So did the old project's labels.
    const subtasks = await db.task.findMany({ where: { parentId: id }, select: { id: true } });
    await dropLabelsOutsideScope([id, ...subtasks.map((subtask) => subtask.id)], labelScope, db);
  }
  if (labels.ids) await setTaskLabels(id, labels.ids, db === prisma ? undefined : db);
  await recordTaskChanges(before, actor.id, db);

  const task = await db.task.findUnique({ where: { id }, include: taskInclude(actor.id) });
  if (!task) return refuse(404, "Task not found");
  const completed = existingTask.status !== "DONE" && task.status === "DONE";
  // Edits in the app show in the task's history only; the AI assistant's show in Activity too (#310).
  if (completed || actor.via) {
    await createActivity(
      {
        userId: existingTask.userId,
        action: completed ? "COMPLETED_TASK" : "UPDATED_TASK",
        message: activityText(`${completed ? "Completed task" : "Updated task"}: “${task.title}”`, actor),
        entityType: "TASK",
        entityId: task.id,
        projectId: task.projectId,
      },
      db,
    );
  }

  return {
    ok: true,
    value: task,
    followUp: {
      // Subtasks moved with it, so both projects' people may see a change.
      feeds: { userIds: [existingTask.userId], projectIds: [existingTask.projectId, projectId] },
      // A new assignee hears about it in their inbox (SMART-08).
      assigned: task.assigneeId && task.assigneeId !== existingTask.assigneeId ? task : undefined,
    },
  };
}

/** Moves a task to the Trash, where whoever trashed it, or its owner, can restore it. */
export async function trashTask(actor: WriteActor, id: string, db: Db = prisma): Promise<WriteResult<TrashedTask>> {
  const existingTask = await db.task.findFirst({
    where: changeableTaskWhere(id, actor.id),
    select: { id: true, title: true, userId: true, projectId: true },
  });
  if (!existingTask) return refuse(404, "Task not found");

  if (existingTask.projectId) {
    const existingAccess = await getProjectAccess(existingTask.projectId, actor.id, db);
    if (!canEditProjectContent(existingAccess)) return refuse(403, unauthorizedProjectResponse("delete tasks").error);
  }

  const deleted = await db.task.updateMany({
    where: { id, deletedAt: null },
    data: { deletedAt: new Date(), deletedById: actor.id },
  });
  if (deleted.count === 0) return refuse(404, "Task not found");

  await createActivity(
    {
      userId: existingTask.userId,
      action: "DELETED_ITEM",
      message: activityText(`Deleted task: “${existingTask.title}”`, actor),
      entityType: "TASK",
      entityId: existingTask.id,
      projectId: existingTask.projectId,
    },
    db,
  );
  return { ok: true, value: existingTask, followUp: { feeds: { userIds: [existingTask.userId], projectIds: [existingTask.projectId] } } };
}
