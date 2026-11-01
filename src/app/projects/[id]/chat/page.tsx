import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
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
    // Phones get the whole width: one slim title row, then the chat edge to edge.
    <main className="flex h-full min-h-0 flex-col overflow-hidden bg-zinc-50 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50 sm:px-6 sm:py-2 lg:px-8">
      <div className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col overflow-hidden sm:gap-1.5">
        <header className="flex min-w-0 items-center gap-1 border-b border-line bg-surface px-2 py-1.5 sm:border-0 sm:bg-transparent sm:px-0">
          <Link
            href={`/projects/${chat.id}`}
            aria-label="Back to Project"
            title="Back to Project"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-hover hover:text-ink"
          >
            <ChevronLeft aria-hidden="true" className="h-5 w-5" />
          </Link>
          <h1 className="truncate text-base font-semibold tracking-tight text-zinc-950 dark:text-zinc-50 sm:text-lg">{chat.name}</h1>
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
