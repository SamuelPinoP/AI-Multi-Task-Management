import { redirect } from "next/navigation";
import { BoardViews } from "@/components/board-views";
import { ProjectKanbanBoard } from "@/components/project-kanban-board";
import { requirePageUser } from "@/lib/auth";
import { projectAccessWhere } from "@/lib/project-access";
import { prisma } from "@/lib/prisma";
import { taskInclude, visibleTaskWhere } from "@/lib/task-include";

type BoardPageProps = { searchParams: Promise<{ view?: string }> };

export default async function BoardPage({ searchParams }: BoardPageProps) {
  const user = await requirePageUser();
  // The tree view has its own pages now (/tree); keep old links working.
  if ((await searchParams).view === "tree") redirect("/tree");

  const [tasks, projects] = await Promise.all([
    prisma.task.findMany({
      // Subtasks show as a progress ring on their parent's card (SMART-02).
      where: { AND: [visibleTaskWhere(user.id), { OR: [{ parentId: null }, { parent: { deletedAt: { not: null } } }] }] },
      orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
      include: taskInclude(user.id),
    }),
    prisma.project.findMany({
      where: projectAccessWhere(user.id),
      orderBy: { updatedAt: "desc" },
      select: { id: true, name: true, color: true },
    }),
  ]);

  return (
    <BoardViews active="kanban">
      <ProjectKanbanBoard
        projectName="All Tasks"
        canEdit
        members={[]}
        projects={projects}
        initialTasks={tasks.map((task) => ({
          ...task,
          dueDate: task.dueDate ? task.dueDate.toISOString() : null,
        }))}
      />
    </BoardViews>
  );
}
