"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { uiButtonClass, uiCardClass, uiPrimaryButtonClass } from "@/components/ui";

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
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const recentPreview = useMemo(() => comments.slice(-3), [comments]);

  useEffect(() => {
    if (!isOpen) return;

    messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [comments, isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setIsOpen(false);
    }

    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [isOpen]);

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
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/70 p-3 backdrop-blur-sm sm:p-5 lg:p-8"
          role="dialog"
          aria-modal="true"
          aria-labelledby="project-chat-title"
          aria-describedby="project-chat-description"
        >
          <div className="flex h-[92vh] w-full max-w-7xl flex-col overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-2xl shadow-zinc-950/30 dark:border-zinc-800 dark:bg-zinc-950 sm:h-[88vh] lg:h-[86vh] lg:w-[88vw]">
            <header className="border-b border-zinc-200 bg-zinc-50/90 px-5 py-4 dark:border-zinc-800 dark:bg-zinc-900/80 sm:px-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500 dark:text-zinc-400">Workspace</p>
                  <h3 id="project-chat-title" className="mt-1 text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
                    Project Chat
                  </h3>
                  <p id="project-chat-description" className="mt-1 max-w-2xl text-sm text-zinc-600 dark:text-zinc-300">
                    Use this shared discussion space for project updates, decisions, blockers, and handoffs.
                  </p>
                </div>
                <button
                  type="button"
                  className="inline-flex items-center justify-center rounded-xl border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-800 transition hover:bg-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-700 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900"
                  onClick={() => setIsOpen(false)}
                >
                  Close
                </button>
              </div>
            </header>

            <div className="flex min-h-0 flex-1 flex-col bg-zinc-100/70 dark:bg-zinc-950">
              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6 lg:px-8">
                <div className="mx-auto flex max-w-5xl flex-col gap-4">
                  {comments.length === 0 ? (
                    <div className="rounded-3xl border border-dashed border-zinc-300 bg-white/80 p-8 text-center shadow-sm dark:border-zinc-700 dark:bg-zinc-900/70">
                      <p className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">No messages yet.</p>
                      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">Start the project conversation with an update, decision, or blocker.</p>
                    </div>
                  ) : (
                    comments.map((comment) => (
                      <article
                        key={comment.id}
                        className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm shadow-sm shadow-zinc-200/70 dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-none sm:p-5"
                      >
                        <div className="flex flex-col gap-1 border-b border-zinc-100 pb-3 dark:border-zinc-800 sm:flex-row sm:items-center sm:justify-between">
                          <p className="font-semibold text-zinc-900 dark:text-zinc-100">{comment.author.name || comment.author.email}</p>
                          <time className="text-xs text-zinc-500" dateTime={comment.createdAt}>
                            {new Date(comment.createdAt).toLocaleString()}
                          </time>
                        </div>
                        <p className="mt-3 whitespace-pre-wrap leading-6 text-zinc-800 dark:text-zinc-200">{comment.message}</p>
                      </article>
                    ))
                  )}
                  <div ref={messagesEndRef} />
                </div>
              </div>

              <form
                className="border-t border-zinc-200 bg-white px-4 py-4 shadow-[0_-12px_35px_rgba(24,24,27,0.08)] dark:border-zinc-800 dark:bg-zinc-950 sm:px-6 lg:px-8"
                onSubmit={(event) => {
                  event.preventDefault();
                  void sendMessage();
                }}
              >
                <div className="mx-auto max-w-5xl">
                  <label htmlFor="project-chat-message" className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                    Add to the discussion
                  </label>
                  <textarea
                    id="project-chat-message"
                    value={message}
                    onChange={(e) => {
                      setMessage(e.target.value);
                      if (error) setError("");
                    }}
                    placeholder="Write a project update, decision, or blocker..."
                    rows={3}
                    className="mt-2 w-full resize-none rounded-2xl border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-900 shadow-sm outline-none transition placeholder:text-zinc-400 focus:border-zinc-500 focus:ring-4 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-500 dark:focus:ring-zinc-800"
                  />
                  <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    {error ? (
                      <p className="text-sm font-medium text-red-600 dark:text-red-400">{error}</p>
                    ) : (
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">Messages are saved to project discussion.</span>
                    )}
                    <button type="submit" className={`${uiPrimaryButtonClass} w-full sm:w-auto`} disabled={isSubmitting}>
                      {isSubmitting ? "Sending..." : "Send message"}
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
