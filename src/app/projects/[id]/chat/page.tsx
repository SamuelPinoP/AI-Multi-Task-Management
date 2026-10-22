import { notFound } from "next/navigation";
import { BackLink } from "@/components/ui";
import { ProjectChatWorkspace } from "@/components/project-chat-workspace";
import { requirePageUser } from "@/lib/auth";
import { openProjectChat } from "@/lib/chats-data";


type ProjectChatPageProps = {
  params: Promise<{ id: string }>;
};

export default async function ProjectChatPage({ params }: ProjectChatPageProps) {
  const { id } = await params;

  const user = await requirePageUser();

  // Also marks the chat read, so the sidebar and the Chats page stop counting it.
  const chat = await openProjectChat(id, user);

  if (!chat) notFound();

  return (
    <main className="flex h-full min-h-0 flex-col overflow-hidden bg-zinc-50 px-4 py-2 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50 sm:px-6 lg:px-8">
      <div className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col gap-1.5 overflow-hidden">
        <header className="rounded-xl border border-zinc-200 bg-white/95 px-3 py-1.5 shadow-sm shadow-zinc-200/50 dark:border-zinc-800 dark:bg-zinc-900/70 dark:shadow-none sm:px-4">
          <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold tracking-tight text-zinc-950 dark:text-zinc-50 sm:text-lg">{chat.name}</h1>
            </div>
            <div className="flex shrink-0 sm:justify-end">
              <BackLink href={`/projects/${chat.id}`} className="rounded-lg px-2.5 py-1 text-xs">Back to Project</BackLink>
            </div>
          </div>
        </header>

        <ProjectChatWorkspace
          projectId={chat.id}
          currentUser={{ name: user.name, email: user.email }}
          readOnly={chat.readOnly}
          attachmentsDisabledMessage={chat.attachmentsDisabledMessage}
          newSince={chat.newSince}
          initialComments={chat.initialComments}
        />
      </div>
    </main>
  );
}
