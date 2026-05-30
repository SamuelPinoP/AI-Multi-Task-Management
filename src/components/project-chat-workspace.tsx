"use client";

import { useEffect, useRef, useState } from "react";
import { uiPrimaryButtonClass } from "@/components/ui";

type ProjectComment = {
  id: string;
  message: string;
  createdAt: string;
  updatedAt: string;
  author: { name: string | null; email: string };
};

type CurrentUser = {
  name: string | null;
  email: string;
};

export function ProjectChatWorkspace({
  projectId,
  initialComments,
  currentUser,
}: {
  projectId: string;
  initialComments: ProjectComment[];
  currentUser: CurrentUser;
}) {
  const [comments, setComments] = useState(initialComments);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [comments]);

  async function sendMessage() {
    const trimmed = message.trim();
    if (!trimmed) {
      setError("Message is required.");
      return;
    }

    const optimisticComment: ProjectComment = {
      id: `pending-${Date.now()}`,
      message: trimmed,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      author: currentUser,
    };

    setIsSubmitting(true);
    setError("");
    setMessage("");
    setComments((prev) => [...prev, optimisticComment]);

    try {
      const res = await fetch(`/api/projects/${projectId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setComments((prev) => prev.filter((comment) => comment.id !== optimisticComment.id));
        setMessage(trimmed);
        setError(data?.error || "Could not send message.");
        return;
      }

      const created = (await res.json()) as ProjectComment;
      setComments((prev) => prev.map((comment) => (comment.id === optimisticComment.id ? created : comment)));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-xl shadow-zinc-200/70 dark:border-zinc-800 dark:bg-zinc-950 dark:shadow-none">
      <div className="border-b border-zinc-200 bg-zinc-50/80 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/70 sm:px-6">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
            {comments.length} message{comments.length === 1 ? "" : "s"}
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Messages save to the project discussion history.</p>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-zinc-100/70 px-4 py-5 dark:bg-zinc-950 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-5xl flex-col gap-4">
          {comments.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-zinc-300 bg-white/80 p-8 text-center shadow-sm dark:border-zinc-700 dark:bg-zinc-900/70">
              <p className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">No messages yet.</p>
              <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
                Start the project conversation with an update, decision, blocker, or handoff note.
              </p>
            </div>
          ) : (
            comments.map((comment) => {
              const isPending = comment.id.startsWith("pending-");

              return (
                <article
                  key={comment.id}
                  className={`rounded-2xl border bg-white p-4 text-sm shadow-sm shadow-zinc-200/70 dark:bg-zinc-900 dark:shadow-none sm:p-5 ${
                    isPending ? "border-zinc-300 opacity-80 dark:border-zinc-700" : "border-zinc-200 dark:border-zinc-800"
                  }`}
                >
                  <div className="flex flex-col gap-1 border-b border-zinc-100 pb-3 dark:border-zinc-800 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-zinc-900 text-xs font-semibold uppercase text-white dark:bg-zinc-100 dark:text-zinc-900">
                        {(comment.author.name || comment.author.email).slice(0, 1)}
                      </span>
                      <p className="font-semibold text-zinc-900 dark:text-zinc-100">{comment.author.name || comment.author.email}</p>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-zinc-500">
                      {isPending ? <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">Sending</span> : null}
                      <time dateTime={comment.createdAt}>{new Date(comment.createdAt).toLocaleString()}</time>
                    </div>
                  </div>
                  <p className="mt-3 whitespace-pre-wrap leading-6 text-zinc-800 dark:text-zinc-200">{comment.message}</p>
                </article>
              );
            })
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
              <span className="text-xs text-zinc-500 dark:text-zinc-400">Empty messages are not sent. Comments are scoped to the demo user.</span>
            )}
            <button type="submit" className={`${uiPrimaryButtonClass} w-full sm:w-auto`} disabled={isSubmitting}>
              {isSubmitting ? "Sending..." : "Send message"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
