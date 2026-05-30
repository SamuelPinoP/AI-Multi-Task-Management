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
        include: { user: { select: { name: true, email: true } }, attachments: { orderBy: { createdAt: "asc" } } },
      },
    },
  });

  if (!project) notFound();

  return (
    <main className="flex min-h-screen flex-col bg-zinc-50 px-4 py-6 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50 sm:px-6 lg:px-8">
      <div className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col gap-3">
        <header className="rounded-2xl border border-zinc-200 bg-white/95 px-4 py-3 shadow-sm shadow-zinc-200/50 dark:border-zinc-800 dark:bg-zinc-900/70 dark:shadow-none sm:px-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">Project Chat</p>
                <span className="rounded-full border border-zinc-200 px-2 py-0.5 text-[11px] font-medium text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                  {project.status.charAt(0) + project.status.slice(1).toLowerCase()}
                </span>
              </div>
              <h1 className="mt-1 truncate text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50 sm:text-2xl">{project.name}</h1>
              <p className="mt-1 max-w-3xl truncate text-sm text-zinc-500 dark:text-zinc-400">
                {project.description || "Updates, decisions, blockers, handoffs, and shared files."}
              </p>
            </div>
            <div className="flex shrink-0 sm:justify-end">
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
            attachments: comment.attachments.map((attachment) => ({
              id: attachment.id,
              fileName: attachment.fileName,
              originalName: attachment.originalName,
              fileType: attachment.fileType,
              fileSize: attachment.fileSize,
              url: attachment.url,
              createdAt: attachment.createdAt.toISOString(),
            })),
          }))}
        />
      </div>
    </main>
  );
}
