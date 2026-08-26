import { notFound } from "next/navigation";
import { BackLink } from "@/components/ui";
import { ProjectChatWorkspace } from "@/components/project-chat-workspace";
import { prisma } from "@/lib/prisma";
import { requirePageUser } from "@/lib/auth";
import { getProjectAccessForUser, projectAccessWhereForProject } from "@/lib/project-access";


type ProjectChatPageProps = {
  params: Promise<{ id: string }>;
};

export default async function ProjectChatPage({ params }: ProjectChatPageProps) {
  const { id } = await params;

  const user = await requirePageUser();

  const project = await prisma.project.findFirst({
    where: projectAccessWhereForProject(id, user.id),
    select: {
      id: true,
      name: true,
      userId: true,
      members: { where: { userId: user.id }, select: { userId: true, role: true } },
      comments: {
        orderBy: { createdAt: "asc" },
        include: { user: { select: { name: true, email: true } }, attachments: { orderBy: { createdAt: "asc" } } },
      },
    },
  });

  if (!project) notFound();

  const access = getProjectAccessForUser(project, user.id);
  const readOnly = access?.accessLevel === "VIEWER";

  return (
    <main className="flex h-full min-h-0 flex-col overflow-hidden bg-zinc-50 px-4 py-2 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50 sm:px-6 lg:px-8">
      <div className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col gap-1.5 overflow-hidden">
        <header className="rounded-xl border border-zinc-200 bg-white/95 px-3 py-1.5 shadow-sm shadow-zinc-200/50 dark:border-zinc-800 dark:bg-zinc-900/70 dark:shadow-none sm:px-4">
          <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold tracking-tight text-zinc-950 dark:text-zinc-50 sm:text-lg">{project.name}</h1>
            </div>
            <div className="flex shrink-0 sm:justify-end">
              <BackLink href={`/projects/${project.id}`} className="rounded-lg px-2.5 py-1 text-xs">Back to Project</BackLink>
            </div>
          </div>
        </header>

        <ProjectChatWorkspace
          projectId={project.id}
          currentUser={{ name: user.name, email: user.email }}
          readOnly={readOnly}
          initialComments={project.comments.map((comment) => ({
            id: comment.id,
            message: comment.message,
            pinned: comment.pinned,
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
