"use client";

import { useMemo, useState } from "react";
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
  const [isOpen, setIsOpen] = useState(false);
  const [comments, setComments] = useState(initialComments);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const recentPreview = useMemo(() => comments.slice(-3), [comments]);

  async function sendMessage() {
    const trimmed = message.trim();
    if (!trimmed) {
      setError("Message is required.");
      return;
    }

    setIsSubmitting(true);
    setError("");

    try {
      const res = await fetch(`/api/projects/${projectId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error || "Could not send message.");
        return;
      }

      const created = (await res.json()) as ProjectComment;
      setComments((prev) => [...prev, created]);
      setMessage("");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="mt-8">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-2xl font-semibold">Project Discussion</h2>
        <button type="button" className={uiButtonClass} onClick={() => setIsOpen(true)}>
          Project Chat
        </button>
      </div>

      <div className={`${uiCardClass} mt-4 p-4`}>
        <p className="text-sm text-zinc-600 dark:text-zinc-300">
          Recent discussion preview ({comments.length} message{comments.length === 1 ? "" : "s"})
        </p>
        <div className="mt-3 space-y-2">
          {recentPreview.length === 0 ? (
            <p className="rounded-xl border border-dashed border-zinc-300 p-3 text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">
              No project discussion yet.
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

      {isOpen ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40" role="dialog" aria-modal="true" aria-label="Project chat panel">
          <div className="flex h-full w-full max-w-2xl flex-col border-l border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-xl font-semibold">Project Chat</h3>
              <button
                type="button"
                className="rounded-lg border border-zinc-300 px-3 py-1 text-sm dark:border-zinc-700"
                onClick={() => setIsOpen(false)}
              >
                Close
              </button>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
              {comments.length === 0 ? (
                <p className="rounded-xl border border-dashed border-zinc-300 p-4 text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">
                  No messages yet. Start the project conversation.
                </p>
              ) : (
                comments.map((comment) => (
                  <article key={comment.id} className="rounded-xl bg-zinc-100 p-3 text-sm dark:bg-zinc-900">
                    <p className="whitespace-pre-wrap text-zinc-800 dark:text-zinc-200">{comment.message}</p>
                    <p className="mt-2 text-xs text-zinc-500">
                      {comment.author.name || comment.author.email} • {new Date(comment.createdAt).toLocaleString()}
                    </p>
                  </article>
                ))
              )}
            </div>

            <div className="mt-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Write a project update, decision, or blocker..."
                rows={3}
                className="w-full rounded-xl border px-3 py-2 text-sm"
              />
              <div className="mt-2 flex items-center justify-between gap-3">
                {error ? <p className="text-sm text-red-600">{error}</p> : <span className="text-xs text-zinc-500">Messages are saved to project discussion.</span>}
                <button type="button" className={uiButtonClass} onClick={() => void sendMessage()} disabled={isSubmitting}>
                  {isSubmitting ? "Sending..." : "Send"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
