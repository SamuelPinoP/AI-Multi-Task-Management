import Link from "next/link";
import { uiButtonClass, uiCardClass } from "@/components/ui";

type ProjectComment = {
  id: string;
  message: string;
  createdAt: string;
  updatedAt: string;
  author: { name: string | null; email: string };
};

export function ProjectChatPanel({
  projectId,
  initialComments,
}: {
  projectId: string;
  initialComments: ProjectComment[];
}) {
  const recentPreview = initialComments.slice(-3);

  return (
    <section className="mt-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Project Discussion</h2>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
            Preview the latest collaboration notes, then open the full chat workspace when you need to respond.
          </p>
        </div>
        <Link href={`/projects/${projectId}/chat`} className={`${uiButtonClass} gap-2 whitespace-nowrap`}>
          <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
            <path d="M4.5 6.5h11M4.5 10h7M4.5 13.5h5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>Open Chat</span>
        </Link>
      </div>

      <div className={`${uiCardClass} mt-4 p-4`}>
        <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
          Recent discussion preview ({initialComments.length} message{initialComments.length === 1 ? "" : "s"})
        </p>
        <div className="mt-3 space-y-2">
          {recentPreview.length === 0 ? (
            <p className="rounded-xl border border-dashed border-zinc-300 p-3 text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">
              No project discussion yet. Open chat to start the conversation.
            </p>
          ) : (
            recentPreview.map((comment) => (
              <article key={comment.id} className="rounded-xl border border-zinc-200 p-3 text-sm dark:border-zinc-800">
                <p className="line-clamp-2 whitespace-pre-wrap text-zinc-800 dark:text-zinc-200">{comment.message}</p>
                <p className="mt-1 text-xs text-zinc-500">
                  {comment.author.name || comment.author.email} • {new Date(comment.createdAt).toLocaleString()}
                </p>
              </article>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
