import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canEditProjectContent, getProjectAccess, unauthorizedProjectResponse } from "@/lib/project-access";
import { visibleTaskWhere } from "@/lib/task-include";

/**
 * Finds a task the user can change: their own personal task, or a task in a
 * project where they can edit content. Otherwise returns the response to send.
 */
export async function findEditableTask(id: string, userId: string) {
  const task = await prisma.task.findFirst({
    where: { id, ...visibleTaskWhere(userId) },
    select: { id: true, projectId: true },
  });
  if (!task) return { response: NextResponse.json({ error: "Task not found" }, { status: 404 }) };
  if (task.projectId && !canEditProjectContent(await getProjectAccess(task.projectId, userId))) {
    return { response: NextResponse.json(unauthorizedProjectResponse("edit tasks"), { status: 403 }) };
  }
  return { task };
}
