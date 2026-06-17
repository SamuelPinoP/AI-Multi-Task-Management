import { ProjectKanbanBoard } from "@/components/project-kanban-board";
import { TreeBoard } from "@/components/tree-board";
import { requirePageUser } from "@/lib/auth";
import { projectAccessWhere } from "@/lib/project-access";
import { prisma } from "@/lib/prisma";

type BoardPageProps = { searchParams: Promise<{ view?: string }> };

const boardViewLinkClass = (isActive: boolean) =>
  `inline-flex items-center justify-center rounded-xl px-4 py-2 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-700 ${
    isActive
      ? "bg-zinc-950 text-white shadow-sm dark:bg-zinc-100 dark:text-zinc-950"
      : "text-zinc-600 hover:bg-white hover:text-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
  }`;

export default async function BoardPage({ searchParams }: BoardPageProps) {
  const user = await requirePageUser();
  const params = await searchParams;
  const view = params.view === "tree" ? "tree" : "kanban";

  const [tasks, projects, treePages] = await Promise.all([
    prisma.task.findMany({
      where: {
        deletedAt: null,
        OR: [{ userId: user.id }, { project: projectAccessWhere(user.id) }],
      },
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
      include: {
        nodes: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
      },
    }),
  ]);

  return (
    <div className="px-4 py-6 sm:px-6 lg:py-8">
      <div className="mx-auto max-w-7xl space-y-5">
        <section className="rounded-[2rem] border border-zinc-200/80 bg-zinc-50/80 p-3 shadow-sm shadow-zinc-200/60 ring-1 ring-white/80 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/50 dark:shadow-none dark:ring-zinc-800/40">
          <nav
            className="flex flex-col gap-3 rounded-[1.5rem] border border-zinc-200/80 bg-white/90 p-3 shadow-sm shadow-zinc-200/50 dark:border-zinc-800 dark:bg-zinc-900/80 dark:shadow-none sm:flex-row sm:items-center sm:justify-between"
            aria-label="Board toolbar"
          >
            <div className="min-w-0 px-1 sm:px-2">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-400">
                Task Board
              </p>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                Plan tasks as cards or shape them into editable trees.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div
                className="inline-flex w-full rounded-2xl bg-zinc-100 p-1 dark:bg-zinc-950/70 sm:w-auto"
                role="tablist"
                aria-label="Board views"
              >
                <a
                  href="/board?view=kanban"
                  className={`${boardViewLinkClass(view === "kanban")} flex-1 sm:flex-none`}
                  aria-current={view === "kanban" ? "page" : undefined}
                >
                  Kanban View
                </a>
                <a
                  href="/board?view=tree"
                  className={`${boardViewLinkClass(view === "tree")} flex-1 sm:flex-none`}
                  aria-current={view === "tree" ? "page" : undefined}
                >
                  Tree View
                </a>
              </div>
              <button
                type="button"
                disabled
                className="inline-flex items-center justify-center rounded-xl border border-dashed border-zinc-300 bg-white/60 px-4 py-2 text-sm font-semibold text-zinc-400 dark:border-zinc-700 dark:bg-zinc-950/40 dark:text-zinc-500"
              >
                Mindnote View — later
              </button>
            </div>
          </nav>
        </section>

        <section className="rounded-[2rem] border border-zinc-200/80 bg-white/70 p-3 shadow-sm shadow-zinc-200/60 ring-1 ring-white/80 dark:border-zinc-800 dark:bg-zinc-950/30 dark:shadow-none dark:ring-zinc-800/40 sm:p-4">
          {view === "tree" ? (
            <TreeBoard
              initialPages={treePages.map((page) => ({
                ...page,
                createdAt: page.createdAt.toISOString(),
                updatedAt: page.updatedAt.toISOString(),
                nodes: page.nodes.map((node) => ({
                  ...node,
                  createdAt: node.createdAt.toISOString(),
                  updatedAt: node.updatedAt.toISOString(),
                })),
              }))}
            />
          ) : (
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
          )}
        </section>
      </div>
    </div>
  );
}
