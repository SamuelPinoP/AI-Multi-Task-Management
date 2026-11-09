import { TaskStatus, type Prisma } from "@prisma/client";
import { after, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { labelScopeFor, labelScopeWhere } from "@/lib/labels-server";
import { notifyTasksAssigned } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import { canEditProjectContent, getProjectAccess, unauthorizedProjectResponse } from "@/lib/project-access";
import { nextCompletedAtFor, parseBulkChange, parseBulkIds, parseSnapshots, type BulkTaskChange, type TaskSnapshot } from "@/lib/task-bulk";
import { formatTaskDueDateInput, parseTaskDueDateForStorage } from "@/lib/task-date-buckets";
import { loadHistoryStates, recordTaskChanges } from "@/lib/task-history-server";
import { taskInclude, visibleTaskWhere } from "@/lib/task-include";

/**
 * Changes or trashes several tasks in one request (#281). All or nothing:
 * every task must exist and be editable by the caller, or nothing changes and
 * the answer names the ones that failed. Each change returns the tasks'
 * earlier values, which the page sends back to undo it.
 */

const TASK_FIELDS = {
  id: true,
  title: true,
  userId: true,
  projectId: true,
  parentId: true,
  status: true,
  priority: true,
  dueDate: true,
  completedAt: true,
  assigneeId: true,
  labels: { select: { labelId: true } },
} satisfies Prisma.TaskSelect;

type LoadedTask = Prisma.TaskGetPayload<{ select: typeof TASK_FIELDS }>;

function snapshotOf(task: LoadedTask): TaskSnapshot {
  return {
    id: task.id,
    status: task.status,
    priority: task.priority,
    dueDate: task.dueDate ? formatTaskDueDateInput(task.dueDate) : null,
    projectId: task.projectId,
    assigneeId: task.assigneeId,
    labelIds: task.labels.map((label) => label.labelId),
  };
}

function badRequest(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

/** The tasks, when the user can see and edit every one; otherwise the response to send. */
async function loadEditable(ids: string[], userId: string): Promise<{ tasks?: LoadedTask[]; response?: NextResponse }> {
  const tasks = await prisma.task.findMany({ where: { id: { in: ids }, ...visibleTaskWhere(userId) }, select: TASK_FIELDS });
  if (tasks.length !== ids.length) {
    const found = new Set(tasks.map((task) => task.id));
    return {
      response: NextResponse.json({ error: "Some of these tasks no longer exist.", missing: ids.filter((id) => !found.has(id)) }, { status: 404 }),
    };
  }
  const projectIds = [...new Set(tasks.flatMap((task) => (task.projectId ? [task.projectId] : [])))];
  const editable = new Set<string>();
  for (const projectId of projectIds) {
    if (canEditProjectContent(await getProjectAccess(projectId, userId))) editable.add(projectId);
  }
  const refused = tasks.filter((task) => task.projectId && !editable.has(task.projectId)).map((task) => task.id);
  if (refused.length) {
    return {
      response: NextResponse.json(
        { error: `You can't edit ${refused.length === 1 ? "one of these tasks" : `${refused.length} of these tasks`}, so nothing changed.`, refused },
        { status: 403 },
      ),
    };
  }
  return { tasks };
}

/** Checks a target project and assignee shared by all the tasks; returns an error message or null. */
async function checkTargets(change: BulkTaskChange, tasks: LoadedTask[], userId: string) {
  if (change.projectId !== undefined) {
    if (tasks.some((task) => task.parentId)) return "Sub-tasks stay in their parent's project; pick only top-level tasks to move.";
    if (change.projectId) {
      const access = await getProjectAccess(change.projectId, userId);
      if (!access) return "Invalid project";
      if (!canEditProjectContent(access)) return unauthorizedProjectResponse("add tasks").error;
    }
  }
  if (change.assigneeId) {
    const projects = new Set(tasks.map((task) => (change.projectId !== undefined ? change.projectId : task.projectId)));
    const [projectId] = [...projects];
    if (projects.size !== 1 || !projectId) return "Only tasks in one project can be assigned together.";
    const member = await prisma.projectMember.findFirst({ where: { id: change.assigneeId, projectId }, select: { id: true } });
    if (!member) return "Invalid assignee";
  }
  if (change.addLabelIds) {
    for (const task of tasks) {
      const scope = labelScopeFor({ projectId: change.projectId !== undefined ? change.projectId : task.projectId, userId: task.userId });
      const fits = await prisma.label.count({ where: { id: { in: change.addLabelIds }, ...labelScopeWhere(scope) } });
      if (fits !== change.addLabelIds.length) return "Those labels don't belong to every chosen task's project.";
    }
  }
  return null;
}

/** Runs after a change: activity for newly done tasks, and assignment notifications. */
function afterChange(before: LoadedTask[], user: { id: string; name: string | null; email: string }) {
  const ids = before.map((task) => task.id);
  after(async () => {
    const tasks = await prisma.task.findMany({
      where: { id: { in: ids } },
      select: { id: true, title: true, userId: true, projectId: true, parentId: true, status: true, assigneeId: true, project: { select: { name: true } } },
    });
    const old = new Map(before.map((task) => [task.id, task]));
    const done = tasks.filter((task) => task.status === TaskStatus.DONE && old.get(task.id)?.status !== TaskStatus.DONE);
    if (done.length) {
      await prisma.activity.createMany({
        data: done.map((task) => ({
          userId: task.userId,
          action: "COMPLETED_TASK" as const,
          message: `Completed task: “${task.title}”`,
          entityType: "TASK" as const,
          entityId: task.id,
          projectId: task.projectId,
        })),
      });
    }
    const assigned = tasks.filter((task) => task.assigneeId && task.assigneeId !== old.get(task.id)?.assigneeId);
    if (assigned.length) await notifyTasksAssigned({ tasks: assigned, actor: user });
  });
}

/**
 * `{ ids, change }` applies one change to every task; `{ restore }` puts
 * each task back to its own earlier values (Undo).
 */
export async function PATCH(req: Request) {
  try {
    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    const body = (await req.json().catch(() => null)) as { ids?: unknown; change?: unknown; restore?: unknown } | null;
    if (!body || typeof body !== "object") return badRequest("Invalid request");

    if (body.restore !== undefined) return restore(body.restore, user);

    const parsedIds = parseBulkIds(body.ids);
    if (!parsedIds.ids) return badRequest(parsedIds.error ?? "Invalid tasks");
    const parsedChange = parseBulkChange(body.change);
    if (!parsedChange.change) return badRequest(parsedChange.error ?? "Invalid change");
    const change = parsedChange.change;

    const loaded = await loadEditable(parsedIds.ids, user.id);
    if (!loaded.tasks) return loaded.response as NextResponse;
    const tasks = loaded.tasks;
    const targetError = await checkTargets(change, tasks, user.id);
    if (targetError) return badRequest(targetError);

    const now = new Date();
    const ids = tasks.map((task) => task.id);
    const data: Prisma.TaskUpdateManyMutationInput & { projectId?: string | null; assigneeId?: string | null } = {};
    if (change.priority) data.priority = change.priority;
    if (change.dueDate !== undefined) data.dueDate = change.dueDate ? parseTaskDueDateForStorage(change.dueDate) : null;
    if (change.projectId !== undefined) {
      data.projectId = change.projectId;
      // Assignees and labels belong to a project, so moving clears them (labels below).
      data.assigneeId = change.assigneeId !== undefined ? change.assigneeId : null;
    } else if (change.assigneeId !== undefined) {
      data.assigneeId = change.assigneeId;
    }

    const writes: Prisma.PrismaPromise<unknown>[] = [];
    if (change.status) {
      const status = change.status;
      // completedAt depends on each task's old status: kept when it stays done.
      const newlyDone = tasks.filter((task) => task.status !== TaskStatus.DONE).map((task) => task.id);
      const wasDone = tasks.filter((task) => task.status === TaskStatus.DONE).map((task) => task.id);
      if (newlyDone.length) writes.push(prisma.task.updateMany({ where: { id: { in: newlyDone } }, data: { ...data, status, completedAt: nextCompletedAtFor("TODO", status, null, now) } }));
      if (wasDone.length) {
        writes.push(
          prisma.task.updateMany({
            where: { id: { in: wasDone } },
            data: status === TaskStatus.DONE ? { ...data, status } : { ...data, status, completedAt: null },
          }),
        );
      }
    } else if (Object.keys(data).length) {
      writes.push(prisma.task.updateMany({ where: { id: { in: ids } }, data }));
    }

    if (change.projectId !== undefined) {
      const subtasks = await prisma.task.findMany({ where: { parentId: { in: ids } }, select: { id: true } });
      const moved = [...ids, ...subtasks.map((subtask) => subtask.id)];
      writes.push(prisma.task.updateMany({ where: { parentId: { in: ids } }, data: { projectId: change.projectId, assigneeId: null } }));
      // Labels that belonged to the old project, or to the owner's personal set, drop off.
      writes.push(
        prisma.taskLabel.deleteMany({
          where: change.projectId
            ? { taskId: { in: moved }, label: { projectId: { not: change.projectId } } }
            : { taskId: { in: moved }, label: { projectId: { not: null } } },
        }),
      );
    }
    if (change.removeLabelIds) writes.push(prisma.taskLabel.deleteMany({ where: { taskId: { in: ids }, labelId: { in: change.removeLabelIds } } }));
    if (change.addLabelIds) {
      const labelIds = change.addLabelIds;
      writes.push(prisma.taskLabel.createMany({ data: ids.flatMap((taskId) => labelIds.map((labelId) => ({ taskId, labelId }))), skipDuplicates: true }));
    }

    const before = await loadHistoryStates(ids);
    await prisma.$transaction(writes);
    await recordTaskChanges(before, user.id);
    afterChange(tasks, user);

    const updated = await prisma.task.findMany({ where: { id: { in: ids } }, include: taskInclude(user.id) });
    return NextResponse.json({ tasks: updated, previous: tasks.map(snapshotOf) });
  } catch (error) {
    console.error("PATCH /api/tasks/bulk error:", error);
    return NextResponse.json({ error: "Failed to update the tasks" }, { status: 500 });
  }
}

/** Undo: each task back to its snapshot, with the same access checks. */
async function restore(input: unknown, user: { id: string; name: string | null; email: string }) {
  const parsed = parseSnapshots(input);
  if (!parsed.snapshots) return badRequest(parsed.error ?? "Nothing to restore");
  const snapshots = parsed.snapshots;
  const loaded = await loadEditable(snapshots.map((snapshot) => snapshot.id), user.id);
  if (!loaded.tasks) return loaded.response as NextResponse;
  const tasks = new Map(loaded.tasks.map((task) => [task.id, task]));

  // The projects tasks go back to must still be editable; labels and assignees that are gone are skipped.
  for (const projectId of new Set(snapshots.flatMap((snapshot) => (snapshot.projectId ? [snapshot.projectId] : [])))) {
    if (!canEditProjectContent(await getProjectAccess(projectId, user.id))) return badRequest("One of those projects can't be edited anymore.", 403);
  }
  const memberIds = new Set(
    (await prisma.projectMember.findMany({ where: { id: { in: snapshots.flatMap((snapshot) => (snapshot.assigneeId ? [snapshot.assigneeId] : [])) } }, select: { id: true, projectId: true } }))
      .map((member) => `${member.projectId}:${member.id}`),
  );
  const labels = await prisma.label.findMany({ where: { id: { in: snapshots.flatMap((snapshot) => snapshot.labelIds) } }, select: { id: true, projectId: true, userId: true } });

  const now = new Date();
  const writes: Prisma.PrismaPromise<unknown>[] = [];
  for (const snapshot of snapshots) {
    const task = tasks.get(snapshot.id) as LoadedTask;
    const assigneeId = snapshot.assigneeId && snapshot.projectId && memberIds.has(`${snapshot.projectId}:${snapshot.assigneeId}`) ? snapshot.assigneeId : null;
    const labelIds = labels
      .filter((label) => snapshot.labelIds.includes(label.id))
      .filter((label) => (snapshot.projectId ? label.projectId === snapshot.projectId : !label.projectId && label.userId === task.userId))
      .map((label) => label.id);
    writes.push(
      prisma.task.update({
        where: { id: snapshot.id },
        data: {
          status: snapshot.status,
          priority: snapshot.priority,
          dueDate: snapshot.dueDate ? parseTaskDueDateForStorage(snapshot.dueDate) : null,
          completedAt: nextCompletedAtFor(task.status, snapshot.status, task.completedAt, now),
          projectId: task.parentId ? task.projectId : snapshot.projectId,
          assigneeId,
        },
      }),
      prisma.taskLabel.deleteMany({ where: { taskId: snapshot.id, labelId: { notIn: labelIds } } }),
      prisma.taskLabel.createMany({ data: labelIds.map((labelId) => ({ taskId: snapshot.id, labelId })), skipDuplicates: true }),
    );
    if (!task.parentId && snapshot.projectId !== task.projectId) {
      writes.push(prisma.task.updateMany({ where: { parentId: snapshot.id }, data: { projectId: snapshot.projectId, assigneeId: null } }));
    }
  }
  const before = await loadHistoryStates(snapshots.map((snapshot) => snapshot.id));
  await prisma.$transaction(writes);
  await recordTaskChanges(before, user.id);
  afterChange(loaded.tasks, user);

  const updated = await prisma.task.findMany({ where: { id: { in: snapshots.map((snapshot) => snapshot.id) } }, include: taskInclude(user.id) });
  return NextResponse.json({ tasks: updated });
}

/** `{ ids }`: moves the tasks to the Trash, where each can be restored. */
export async function DELETE(req: Request) {
  try {
    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    const body = (await req.json().catch(() => null)) as { ids?: unknown } | null;
    const parsedIds = parseBulkIds(body?.ids);
    if (!parsedIds.ids) return badRequest(parsedIds.error ?? "Invalid tasks");

    const loaded = await loadEditable(parsedIds.ids, user.id);
    if (!loaded.tasks) return loaded.response as NextResponse;
    const tasks = loaded.tasks;

    await prisma.$transaction([
      prisma.task.updateMany({ where: { id: { in: tasks.map((task) => task.id) }, deletedAt: null }, data: { deletedAt: new Date(), deletedById: user.id } }),
      prisma.activity.createMany({
        data: tasks.map((task) => ({
          userId: task.userId,
          action: "DELETED_ITEM" as const,
          message: `Deleted task: “${task.title}”`,
          entityType: "TASK" as const,
          entityId: task.id,
          projectId: task.projectId,
        })),
      }),
    ]);
    return NextResponse.json({ deleted: tasks.length });
  } catch (error) {
    console.error("DELETE /api/tasks/bulk error:", error);
    return NextResponse.json({ error: "Failed to delete the tasks" }, { status: 500 });
  }
}
