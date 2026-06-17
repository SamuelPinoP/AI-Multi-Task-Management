import { ProjectKanbanBoard } from "@/components/project-kanban-board";
import { TreeBoard } from "@/components/tree-board";
import { requirePageUser } from "@/lib/auth";
import { projectAccessWhere } from "@/lib/project-access";
import { prisma } from "@/lib/prisma";

type BoardPageProps = { searchParams: Promise<{ view?: string }> };

export default async function BoardPage({ searchParams }: BoardPageProps) {
  const user = await requirePageUser();
  const params = await searchParams;
  const view = params.view === "tree" ? "tree" : "kanban";

  const [tasks, projects, treePages] = await Promise.all([
    prisma.task.findMany({
      where: { deletedAt: null, OR: [{ userId: user.id }, { project: projectAccessWhere(user.id) }] },
      orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
      include: {
        project: { select: { id: true, name: true, color: true } },
        assignee: { select: { id: true, name: true, email: true, role: true } },
      },
    }),
    prisma.project.findMany({
      where: projectAccessWhere(user.id),
      orderBy: { updatedAt: "desc" },
      select: { id: true, name: true, color: true },
    }),
    prisma.treePage.findMany({
      where: { userId: user.id },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      include: { nodes: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] } },
    }),
  ]);

  return (
    <div className="px-6 py-10">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="rounded-3xl border border-zinc-200 bg-white/90 p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/70">
          <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Main productivity area</p>
          <h1 className="mt-1 text-4xl font-bold tracking-tight">Task Board</h1>
          <p className="mt-3 max-w-3xl text-sm text-zinc-600 dark:text-zinc-300">Switch between a Kanban command center and editable hierarchical Tree View pages. Mindnote View is planned for a later release.</p>
          <div className="mt-5 flex flex-wrap gap-2" role="tablist" aria-label="Board views">
            <a href="/board?view=kanban" className={`rounded-full border px-4 py-2 text-sm font-semibold ${view === "kanban" ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950" : "border-zinc-200 bg-white text-zinc-700 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200"}`}>Kanban View</a>
            <a href="/board?view=tree" className={`rounded-full border px-4 py-2 text-sm font-semibold ${view === "tree" ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950" : "border-zinc-200 bg-white text-zinc-700 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200"}`}>Tree View</a>
            <button type="button" disabled className="rounded-full border border-dashed border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-400 dark:border-zinc-700">Mindnote View — later</button>
          </div>
        </section>

        {view === "tree" ? (
          <TreeBoard initialPages={treePages.map((page) => ({ ...page, createdAt: page.createdAt.toISOString(), updatedAt: page.updatedAt.toISOString(), nodes: page.nodes.map((node) => ({ ...node, createdAt: node.createdAt.toISOString(), updatedAt: node.updatedAt.toISOString() })) }))} />
        ) : (
          <ProjectKanbanBoard projectName="All Tasks" canEdit members={[]} projects={projects} initialTasks={tasks.map((task) => ({ ...task, dueDate: task.dueDate ? task.dueDate.toISOString() : null }))} />
        )}
      </div>
    </div>
  );
}
