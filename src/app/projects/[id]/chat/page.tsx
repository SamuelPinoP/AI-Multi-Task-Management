import { notFound } from "next/navigation";
import { BackLink } from "@/components/ui";
import { ProjectChatWorkspace } from "@/components/project-chat-workspace";
import { prisma } from "@/lib/prisma";

const DEMO_USER_EMAIL = "samuel@example.com";

type ProjectChatPageProps = {
  params: Promise<{ id: string }>;
};

export default async function ProjectChatPage({ params }: ProjectChatPageProps) {
  const { id } = await params;

  const user = await prisma.user.findUnique({
    where: { email: DEMO_USER_EMAIL },
    select: { id: true, name: true, email: true },
  });

  if (!user) notFound();

  const project = await prisma.project.findFirst({
    where: { id, userId: user.id },
    select: {
      id: true,
      name: true,
      description: true,
      status: true,
      comments: {
        orderBy: { createdAt: "asc" },
        include: { user: { select: { name: true, email: true } } },
      },
    },
  });

  if (!project) notFound();

  return (
    <main className="flex min-h-screen flex-col bg-zinc-50 px-4 py-6 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50 sm:px-6 lg:px-8">
      <div className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col gap-5">
        <header className="rounded-3xl border border-zinc-200 bg-white/95 p-5 shadow-sm shadow-zinc-200/60 dark:border-zinc-800 dark:bg-zinc-900/70 dark:shadow-none sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500 dark:text-zinc-400">Collaboration Workspace</p>
              <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Project Chat</h1>
              <p className="mt-2 text-lg font-medium text-zinc-800 dark:text-zinc-100">{project.name}</p>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-zinc-600 dark:text-zinc-300">
                {project.description || "Use this full-screen discussion space for project updates, decisions, blockers, and handoffs."}
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center lg:justify-end">
              <span className="inline-flex items-center justify-center rounded-xl border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">
                Status: {project.status.charAt(0) + project.status.slice(1).toLowerCase()}
              </span>
              <BackLink href={`/projects/${project.id}`}>Back to Project</BackLink>
            </div>
          </div>
        </header>

        <ProjectChatWorkspace
          projectId={project.id}
          currentUser={{ name: user.name, email: user.email }}
          initialComments={project.comments.map((comment) => ({
            id: comment.id,
            message: comment.message,
            createdAt: comment.createdAt.toISOString(),
            updatedAt: comment.updatedAt.toISOString(),
            author: { name: comment.user.name, email: comment.user.email },
          }))}
        />
      </div>
    </main>
  );
}
