"use client";

import { useState } from "react";
import { uiButtonClass, uiCardClass } from "@/components/ui";

type ProjectComment = {
  id: string;
  message: string;
  createdAt: string;
  updatedAt: string;
  author: { name: string | null; email: string };
};

export function ProjectDiscussionSection({
  projectId,
  initialComments,
  projectColor,
}: {
  projectId: string;
  initialComments: ProjectComment[];
  projectColor: string | null;
}) {
  const [comments, setComments] = useState(initialComments);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function addComment() {
    const trimmed = message.trim();
    if (!trimmed) {
      setError("Comment message is required.");
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
        setError(data?.error || "Could not add project comment.");
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
      <div className="mb-4 flex items-center gap-2">
        <h2 className="text-2xl font-semibold">Project Discussion</h2>
        <span
          className="inline-block h-2.5 w-2.5 rounded-full border border-zinc-300 dark:border-zinc-700"
          style={{ backgroundColor: projectColor || "transparent" }}
          aria-hidden
        />
      </div>

      <div className={`${uiCardClass} p-4`}>
        <div className="space-y-2">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Share an update, decision, or team message..."
            rows={3}
            className="w-full rounded-xl border px-3 py-2 text-sm"
          />
          <div className="flex items-center gap-3">
            <button type="button" className={uiButtonClass} onClick={() => void addComment()} disabled={isSubmitting}>
              {isSubmitting ? "Adding..." : "Add Comment"}
            </button>
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
          </div>
        </div>

        <div className="mt-4 space-y-2">
          {comments.length === 0 ? (
            <p className="rounded-xl border border-dashed border-zinc-300 p-4 text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">
              No project discussion yet.
            </p>
          ) : (
            comments.map((comment) => (
              <article key={comment.id} className="rounded-xl border border-zinc-200 p-3 text-sm dark:border-zinc-800">
                <p className="whitespace-pre-wrap text-zinc-800 dark:text-zinc-200">{comment.message}</p>
                <p className="mt-2 text-xs text-zinc-500">
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
