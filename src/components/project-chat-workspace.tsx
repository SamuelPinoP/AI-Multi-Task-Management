"use client";

import { ChangeEvent, DragEvent, useEffect, useRef, useState } from "react";
import { uiButtonClass, uiPrimaryButtonClass } from "@/components/ui";

type ProjectCommentAttachment = {
  id: string;
  fileName: string;
  originalName: string;
  fileType: string;
  fileSize: number;
  url: string;
  createdAt: string;
};

type ProjectComment = {
  id: string;
  message: string;
  createdAt: string;
  updatedAt: string;
  author: { name: string | null; email: string };
  attachments: ProjectCommentAttachment[];
};

type CurrentUser = {
  name: string | null;
  email: string;
};

type SelectedAttachment = {
  id: string;
  file: File;
  previewUrl: string;
};

const MAX_FILES_PER_MESSAGE = 5;
const MAX_FILE_SIZE = 10 * 1024 * 1024;

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileKind(fileType: string, fileName: string) {
  const lowerName = fileName.toLowerCase();
  if (fileType.startsWith("image/")) return "image";
  if (fileType.startsWith("video/")) return "video";
  if (fileType === "application/pdf" || lowerName.endsWith(".pdf")) return "pdf";
  if (lowerName.endsWith(".doc") || lowerName.endsWith(".docx")) return "word";
  return "file";
}

function AttachmentCard({ attachment }: { attachment: ProjectCommentAttachment }) {
  const kind = getFileKind(attachment.fileType, attachment.originalName);

  return (
    <a
      href={attachment.url}
      target="_blank"
      rel="noreferrer"
      className="group block overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-50 text-zinc-800 transition hover:-translate-y-0.5 hover:border-zinc-300 hover:bg-white dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:border-zinc-700 dark:hover:bg-zinc-900"
    >
      {kind === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={attachment.url} alt={attachment.originalName} className="h-32 w-full object-cover" />
      ) : kind === "video" ? (
        <video src={attachment.url} className="h-32 w-full bg-black object-cover" controls preload="metadata" />
      ) : null}
      <div className="flex items-center gap-3 p-3">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-zinc-200 text-xs font-bold uppercase text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
          {kind === "pdf" ? "PDF" : kind === "word" ? "DOC" : kind === "video" ? "VID" : kind === "image" ? "IMG" : "FILE"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold group-hover:underline">{attachment.originalName}</span>
          <span className="block text-xs text-zinc-500 dark:text-zinc-400">
            {attachment.fileType || "File"} • {formatFileSize(attachment.fileSize)}
          </span>
        </span>
      </div>
    </a>
  );
}

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
  const [selectedAttachments, setSelectedAttachments] = useState<SelectedAttachment[]>([]);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [comments]);


  function addFiles(fileList: FileList | File[]) {
    const nextFiles = Array.from(fileList).filter((file) => file.size > 0);
    if (nextFiles.length === 0) return;

    const availableSlots = MAX_FILES_PER_MESSAGE - selectedAttachments.length;
    if (availableSlots <= 0) {
      setError(`You can attach up to ${MAX_FILES_PER_MESSAGE} files per message.`);
      return;
    }

    const oversized = nextFiles.find((file) => file.size > MAX_FILE_SIZE);
    if (oversized) {
      setError(`${oversized.name} is larger than the 10 MB file limit.`);
      return;
    }

    setError("");
    setSelectedAttachments((prev) => [
      ...prev,
      ...nextFiles.slice(0, availableSlots).map((file) => ({
        id: `${file.name}-${file.lastModified}-${crypto.randomUUID()}`,
        file,
        previewUrl: URL.createObjectURL(file),
      })),
    ]);

    if (nextFiles.length > availableSlots) {
      setError(`Only ${availableSlots} more file${availableSlots === 1 ? "" : "s"} could be added.`);
    }
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files) addFiles(event.target.files);
    event.target.value = "";
  }

  function removeSelectedAttachment(id: string) {
    setSelectedAttachments((prev) => {
      const attachment = prev.find((item) => item.id === id);
      if (attachment) URL.revokeObjectURL(attachment.previewUrl);
      return prev.filter((item) => item.id !== id);
    });
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    if (event.dataTransfer.files.length > 0) addFiles(event.dataTransfer.files);
  }

  async function sendMessage() {
    const trimmed = message.trim();
    if (!trimmed && selectedAttachments.length === 0) {
      setError("Add a message or attach at least one file.");
      return;
    }

    const optimisticAttachments: ProjectCommentAttachment[] = selectedAttachments.map((attachment) => ({
      id: `pending-${attachment.id}`,
      fileName: attachment.file.name,
      originalName: attachment.file.name,
      fileType: attachment.file.type || "application/octet-stream",
      fileSize: attachment.file.size,
      url: attachment.previewUrl,
      createdAt: new Date().toISOString(),
    }));

    const optimisticComment: ProjectComment = {
      id: `pending-${Date.now()}`,
      message: trimmed,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      author: currentUser,
      attachments: optimisticAttachments,
    };

    const attachmentsToSend = [...selectedAttachments];
    const formData = new FormData();
    formData.append("message", trimmed);
    attachmentsToSend.forEach((attachment) => formData.append("attachments", attachment.file));

    setIsSubmitting(true);
    setError("");
    setMessage("");
    setSelectedAttachments([]);
    setComments((prev) => [...prev, optimisticComment]);

    try {
      const res = await fetch(`/api/projects/${projectId}/comments`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setComments((prev) => prev.filter((comment) => comment.id !== optimisticComment.id));
        setMessage(trimmed);
        setSelectedAttachments(attachmentsToSend);
        setError(data?.error || "Could not send message.");
        return;
      }

      const created = (await res.json()) as ProjectComment;
      setComments((prev) => prev.map((comment) => (comment.id === optimisticComment.id ? created : comment)));
      attachmentsToSend.forEach((attachment) => URL.revokeObjectURL(attachment.previewUrl));
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
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Messages and attachments save to the project discussion history.</p>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-zinc-100/70 px-4 py-5 dark:bg-zinc-950 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-5xl flex-col gap-4">
          {comments.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-zinc-300 bg-white/80 p-8 text-center shadow-sm dark:border-zinc-700 dark:bg-zinc-900/70">
              <p className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">No messages yet.</p>
              <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
                Start the project conversation with an update, decision, blocker, handoff note, or file attachment.
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
                  {comment.message ? <p className="mt-3 whitespace-pre-wrap leading-6 text-zinc-800 dark:text-zinc-200">{comment.message}</p> : null}
                  {comment.attachments.length > 0 ? (
                    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {comment.attachments.map((attachment) => (
                        <AttachmentCard key={attachment.id} attachment={attachment} />
                      ))}
                    </div>
                  ) : null}
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
          <div
            className={`mt-2 rounded-2xl border transition ${
              isDragging
                ? "border-zinc-500 bg-zinc-100 ring-4 ring-zinc-200 dark:border-zinc-400 dark:bg-zinc-900 dark:ring-zinc-800"
                : "border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900"
            }`}
            onDragEnter={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
          >
            <textarea
              id="project-chat-message"
              value={message}
              onChange={(e) => {
                setMessage(e.target.value);
                if (error) setError("");
              }}
              placeholder="Write an update, or attach files below..."
              rows={3}
              className="w-full resize-none rounded-2xl border-0 bg-transparent px-4 py-3 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100"
            />
            {selectedAttachments.length > 0 ? (
              <div className="border-t border-zinc-200 px-3 py-3 dark:border-zinc-800">
                <div className="flex max-h-28 flex-wrap gap-2 overflow-y-auto pr-1">
                  {selectedAttachments.map((attachment) => (
                    <div key={attachment.id} className="flex max-w-full items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs dark:border-zinc-700 dark:bg-zinc-950">
                      <span className="max-w-52 truncate font-medium text-zinc-800 dark:text-zinc-100">{attachment.file.name}</span>
                      <span className="shrink-0 text-zinc-500">{formatFileSize(attachment.file.size)}</span>
                      <button
                        type="button"
                        onClick={() => removeSelectedAttachment(attachment.id)}
                        className="shrink-0 rounded-full px-1.5 py-0.5 font-semibold text-zinc-500 hover:bg-zinc-200 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                        aria-label={`Remove ${attachment.file.name}`}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="flex flex-col gap-2 border-t border-zinc-200 px-3 py-3 dark:border-zinc-800 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Drop files here or attach up to {MAX_FILES_PER_MESSAGE} files, 10 MB each.</p>
              <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileChange} />
              <button type="button" className={`${uiButtonClass} w-full px-3 py-1.5 text-xs sm:w-auto`} onClick={() => fileInputRef.current?.click()} disabled={isSubmitting}>
                Attach files
              </button>
            </div>
          </div>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            {error ? (
              <p className="text-sm font-medium text-red-600 dark:text-red-400">{error}</p>
            ) : (
              <span className="text-xs text-zinc-500 dark:text-zinc-400">Send text, files, or both. Empty messages without attachments are not sent.</span>
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
