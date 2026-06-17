import { BackLink } from "@/components/ui";
import { ProjectKanbanBoard } from "@/components/project-kanban-board";
import { requirePageUser } from "@/lib/auth";
import { getProjectAccessForUser, projectAccessWhereForProject } from "@/lib/project-access";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";

type ProjectBoardPageProps = {
  params: Promise<{ id: string }>;
};

export default async function ProjectBoardPage({ params }: ProjectBoardPageProps) {
  const user = await requirePageUser();
  const { id } = await params;

  const project = await prisma.project.findFirst({
    where: projectAccessWhereForProject(id, user.id),
    select: {
      id: true,
      name: true,
      userId: true,
      members: {
        orderBy: { createdAt: "asc" },
        select: { id: true, name: true, email: true, role: true, userId: true },
      },
      tasks: {
        where: { deletedAt: null },
        orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
        select: {
          id: true,
          title: true,
          description: true,
          status: true,
          priority: true,
          dueDate: true,
          recurrence: true,
          projectId: true,
          assigneeId: true,
          assignee: { select: { id: true, name: true, email: true, role: true } },
        },
      },
    },
  });

  if (!project) notFound();

  const access = getProjectAccessForUser(project, user.id);
  const canEdit = access?.accessLevel === "OWNER" || access?.accessLevel === "EDITOR";

  return (
    <main className="min-h-screen px-6 py-10">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <BackLink href={`/projects/${project.id}`}>Back to Project</BackLink>
        </div>
        <ProjectKanbanBoard
          projectId={project.id}
          projectName={project.name}
          canEdit={canEdit}
          members={project.members.map((member) => ({
            id: member.id,
            name: member.name,
            email: member.email,
            role: member.role,
          }))}
          initialTasks={project.tasks.map((task) => ({
            ...task,
            dueDate: task.dueDate ? task.dueDate.toISOString() : null,
          }))}
        />
      </div>
    </main>
  );
}
