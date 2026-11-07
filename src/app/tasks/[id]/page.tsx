import type { Metadata } from "next";
import Link from "next/link";
import { TaskPageView } from "@/components/tasks/task-page-view";
import type { Task } from "@/components/tasks/types";
import { requirePageUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canEditProjectContent, getProjectAccess } from "@/lib/project-access";
import { taskInclude, visibleTaskWhere } from "@/lib/task-include";

type TaskPageProps = { params: Promise<{ id: string }> };

export const metadata: Metadata = { title: "Task" };

/**
 * A task as its own page (#352, design 2A), like a Linear issue: title,
 * description, sub-tasks and activity, with its properties beside them.
 */
export default async function TaskPage({ params }: TaskPageProps) {
  const user = await requirePageUser();
  const { id } = await params;

  const task = await prisma.task.findFirst({ where: { id, ...visibleTaskWhere(user.id) }, include: taskInclude(user.id) });
  if (!task) {
    return (
      <div className="mx-auto grid max-w-xl gap-2 px-4 py-16 text-center">
        <h1 className="text-title">Task not found</h1>
        <p className="text-sm text-muted">It may have moved to the Trash, or you may no longer have access to its project.</p>
        <Link href="/tasks" className="mx-auto mt-2 text-sm font-semibold text-accent underline underline-offset-4">
          Back to Tasks
        </Link>
      </div>
    );
  }

  const canEdit = !task.projectId || canEditProjectContent(await getProjectAccess(task.projectId, user.id));
  const parent = task.parentId
    ? await prisma.task.findFirst({ where: { id: task.parentId, ...visibleTaskWhere(user.id) }, select: { id: true, title: true, status: true } })
    : null;

  // The same shape /api/tasks returns, with dates as strings.
  const initialTask = JSON.parse(JSON.stringify(task)) as Task;
  return <TaskPageView initialTask={initialTask} parent={parent} canEdit={canEdit} />;
}
