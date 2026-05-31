"use client";

import { ChangeEvent, DragEvent, useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
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
  pinned: boolean;
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
const STANDARD_FILE_SIZE_LIMIT = 10 * 1024 * 1024;
const VIDEO_FILE_SIZE_LIMIT = 100 * 1024 * 1024;
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".webm", ".m4v"]);

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileExtension(fileName: string) {
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex >= 0 ? fileName.slice(dotIndex).toLowerCase() : "";
}

function isVideoFile(file: File) {
  return file.type.startsWith("video/") || VIDEO_EXTENSIONS.has(getFileExtension(file.name));
}

function fileSizeLimit(file: File) {
  return isVideoFile(file) ? VIDEO_FILE_SIZE_LIMIT : STANDARD_FILE_SIZE_LIMIT;
}

function getFileKind(fileType: string, fileName: string) {
  const lowerName = fileName.toLowerCase();
  if (fileType.startsWith("image/")) return "image";
  if (fileType.startsWith("video/")) return "video";
  if (fileType === "application/pdf" || lowerName.endsWith(".pdf")) return "pdf";
  if (lowerName.endsWith(".doc") || lowerName.endsWith(".docx")) return "word";
  return "file";
}

function isEdited(comment: ProjectComment) {
  return new Date(comment.updatedAt).getTime() - new Date(comment.createdAt).getTime() > 1000;
}

function PinIcon({ filled = false, className = "h-3.5 w-3.5" }: { filled?: boolean; className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.7" className={className}>
      <path d="M6.75 3.25h6.5l-1.1 5.1 2.35 2.35v1.05H10.8L10 17l-.8-5.25H5.5V10.7l2.35-2.35-1.1-5.1Z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PaperclipIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path d="m7.25 10.75 4.7-4.7a2.35 2.35 0 0 1 3.32 3.32l-5.55 5.55a4 4 0 0 1-5.66-5.66l5.75-5.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
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
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editMessage, setEditMessage] = useState("");
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [mutatingCommentId, setMutatingCommentId] = useState<string | null>(null);
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

    const oversized = nextFiles.find((file) => file.size > fileSizeLimit(file));
    if (oversized) {
      setError(`${oversized.name} is ${formatFileSize(oversized.size)} and exceeds the ${formatFileSize(fileSizeLimit(oversized))} limit for this file type.`);
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

    const now = new Date().toISOString();
    const optimisticAttachments: ProjectCommentAttachment[] = selectedAttachments.map((attachment) => ({
      id: `pending-${attachment.id}`,
      fileName: attachment.file.name,
      originalName: attachment.file.name,
      fileType: attachment.file.type || "application/octet-stream",
      fileSize: attachment.file.size,
      url: attachment.previewUrl,
      createdAt: now,
    }));

    const optimisticComment: ProjectComment = {
      id: `pending-${Date.now()}`,
      message: trimmed,
      createdAt: now,
      pinned: false,
      updatedAt: now,
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

  function startEditing(comment: ProjectComment) {
    setEditingCommentId(comment.id);
    setEditMessage(comment.message);
    setError("");
  }

  async function saveEditedMessage(comment: ProjectComment) {
    const trimmed = editMessage.trim();
    if (!trimmed && comment.attachments.length === 0) {
      setError("Edited message cannot be empty unless it has attachments.");
      return;
    }

    const previousComments = comments;
    const optimisticUpdatedAt = new Date().toISOString();
    setMutatingCommentId(comment.id);
    setError("");
    setEditingCommentId(null);
    setComments((prev) => prev.map((item) => (item.id === comment.id ? { ...item, message: trimmed, updatedAt: optimisticUpdatedAt } : item)));

    try {
      const res = await fetch(`/api/projects/${projectId}/comments/${comment.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setComments(previousComments);
        setEditingCommentId(comment.id);
        setEditMessage(comment.message);
        setError(data?.error || "Could not edit message.");
        return;
      }

      const updated = (await res.json()) as ProjectComment;
      setComments((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      setEditMessage("");
    } finally {
      setMutatingCommentId(null);
    }
  }

  async function deleteMessage() {
    if (!deleteTargetId) return;
    const commentId = deleteTargetId;
    const previousComments = comments;

    setMutatingCommentId(commentId);
    setDeleteTargetId(null);
    setError("");
    setComments((prev) => prev.filter((comment) => comment.id !== commentId));

    try {
      const res = await fetch(`/api/projects/${projectId}/comments/${commentId}`, { method: "DELETE" });

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setComments(previousComments);
        setError(data?.error || "Could not delete message.");
      }
    } finally {
      setMutatingCommentId(null);
    }
  }

  const pinnedComments = comments
    .filter((comment) => comment.pinned && !comment.id.startsWith("pending-"))
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 3);

  function jumpToComment(commentId: string) {
    document.getElementById(`comment-${commentId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  async function togglePinned(comment: ProjectComment) {
    const previousComments = comments;
    const nextPinned = !comment.pinned;

    setMutatingCommentId(comment.id);
    setError("");
    setComments((prev) => prev.map((item) => (item.id === comment.id ? { ...item, pinned: nextPinned } : item)));

    try {
      const res = await fetch(`/api/projects/${projectId}/comments/${comment.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned: nextPinned }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setComments(previousComments);
        setError(data?.error || "Could not update pinned message.");
        return;
      }

      const updated = (await res.json()) as ProjectComment;
      setComments((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
    } finally {
      setMutatingCommentId(null);
    }
  }

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-xl shadow-zinc-200/70 dark:border-zinc-800 dark:bg-zinc-950 dark:shadow-none">
        {pinnedComments.length > 0 ? (
          <section className="bg-white/95 px-4 py-3 dark:bg-zinc-950 sm:px-6" aria-label="Pinned messages">
            <div className="mx-auto max-w-5xl rounded-2xl bg-amber-50/80 p-3 ring-1 ring-amber-200/70 dark:bg-amber-950/20 dark:ring-amber-900/60">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-amber-700 dark:text-amber-300">
                <PinIcon filled className="h-3.5 w-3.5" />
                Pinned messages
              </div>
              <div className="grid gap-2 md:grid-cols-3">
                {pinnedComments.map((comment) => (
                  <button
                    key={comment.id}
                    type="button"
                    onClick={() => jumpToComment(comment.id)}
                    className="min-w-0 rounded-xl bg-white/85 px-3 py-2 text-left text-sm shadow-sm transition hover:-translate-y-0.5 hover:bg-white dark:bg-zinc-900/80 dark:hover:bg-zinc-900"
                  >
                    <span className="block truncate font-medium text-zinc-900 dark:text-zinc-100">{comment.author.name || comment.author.email}</span>
                    <span className="mt-1 block truncate text-xs text-zinc-600 dark:text-zinc-300">{comment.message || `${comment.attachments.length} attachment${comment.attachments.length === 1 ? "" : "s"}`}</span>
                  </button>
                ))}
              </div>
            </div>
          </section>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto bg-zinc-100/60 px-4 py-6 dark:bg-zinc-950 sm:px-6 lg:px-8">
          <div className="mx-auto flex max-w-5xl flex-col gap-5">
            {comments.length === 0 ? (
              <div className="rounded-3xl bg-white/80 p-8 text-center shadow-sm ring-1 ring-zinc-200/70 dark:bg-zinc-900/70 dark:ring-zinc-800/70">
                <p className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">No messages yet.</p>
              </div>
            ) : (
              comments.map((comment) => {
                const isPending = comment.id.startsWith("pending-");
                const isOwnMessage = comment.author.email === currentUser.email && !isPending;
                const isEditing = editingCommentId === comment.id;
                const isMutating = mutatingCommentId === comment.id;

                return (
                  <article
                    id={`comment-${comment.id}`}
                    key={comment.id}
                    className={`rounded-3xl bg-white/95 p-4 text-sm shadow-sm shadow-zinc-200/60 ring-1 transition dark:bg-zinc-900/80 dark:shadow-none sm:p-5 ${
                      isPending ? "opacity-80 ring-zinc-300 dark:ring-zinc-700" : comment.pinned ? "ring-amber-200 dark:ring-amber-900/70" : "ring-zinc-200/70 dark:ring-zinc-800/70"
                    }`}
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-zinc-900 text-xs font-semibold uppercase text-white dark:bg-zinc-100 dark:text-zinc-900">
                          {(comment.author.name || comment.author.email).slice(0, 1)}
                        </span>
                        <div>
                          <p className="font-semibold text-zinc-900 dark:text-zinc-100">{comment.author.name || comment.author.email}</p>
                          {isOwnMessage ? <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">You</p> : null}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                        {comment.pinned ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
                            <PinIcon filled />
                            Pinned
                          </span>
                        ) : null}
                        {isPending ? <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">Sending</span> : null}
                        {isMutating ? <span className="rounded-full bg-zinc-100 px-2 py-0.5 font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">Saving</span> : null}
                        {isEdited(comment) ? <span className="rounded-full bg-zinc-100 px-2 py-0.5 font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-300">Edited</span> : null}
                        <time dateTime={comment.createdAt}>{new Date(comment.createdAt).toLocaleString()}</time>
                        {isOwnMessage ? (
                          <span className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => void togglePinned(comment)}
                              disabled={isMutating}
                              className={`inline-flex items-center gap-1 rounded-full px-2 py-1 font-medium transition disabled:opacity-50 ${
                                comment.pinned
                                  ? "bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:hover:bg-amber-950"
                                  : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                              }`}
                              aria-label={comment.pinned ? "Unpin message" : "Pin message"}
                              title={comment.pinned ? "Unpin message" : "Pin message"}
                            >
                              <PinIcon filled={comment.pinned} />
                              <span>{comment.pinned ? "Unpin" : "Pin"}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => startEditing(comment)}
                              disabled={isMutating}
                              className="inline-flex items-center gap-1 rounded-full px-2 py-1 font-medium text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-50 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                            >
                              <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-3.5 w-3.5">
                                <path d="m4 14.5-.5 2 2-.5 9.25-9.25a1.4 1.4 0 0 0-2-2L4 14.5Z" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                              <span>Edit</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteTargetId(comment.id)}
                              disabled={isMutating}
                              className="inline-flex items-center gap-1 rounded-full px-2 py-1 font-medium text-red-500 transition hover:bg-red-50 hover:text-red-700 disabled:opacity-50 dark:hover:bg-red-950/40 dark:hover:text-red-300"
                              aria-label="Delete message"
                            >
                              <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-3.5 w-3.5">
                                <path d="M7 5V3.75A1.25 1.25 0 0 1 8.25 2.5h3.5A1.25 1.25 0 0 1 13 3.75V5m3 0H4m1.25 0 .6 10.4A1.75 1.75 0 0 0 7.6 17h4.8a1.75 1.75 0 0 0 1.75-1.6L14.75 5" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                              <span>Delete</span>
                            </button>
                          </span>
                        ) : null}
                      </div>
                    </div>
                    {isEditing ? (
                      <div className="mt-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-950">
                        <label htmlFor={`edit-${comment.id}`} className="sr-only">
                          Edit message
                        </label>
                        <textarea
                          id={`edit-${comment.id}`}
                          value={editMessage}
                          onChange={(event) => setEditMessage(event.target.value)}
                          rows={3}
                          className="w-full resize-none rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                        />
                        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:justify-end">
                          <button
                            type="button"
                            className={`${uiButtonClass} px-3 py-1.5 text-xs`}
                            onClick={() => {
                              setEditingCommentId(null);
                              setEditMessage("");
                            }}
                          >
                            Cancel
                          </button>
                          <button type="button" className={`${uiPrimaryButtonClass} px-3 py-1.5 text-xs`} onClick={() => void saveEditedMessage(comment)}>
                            Save edit
                          </button>
                        </div>
                      </div>
                    ) : comment.message ? (
                      <p className="mt-3 whitespace-pre-wrap leading-6 text-zinc-800 dark:text-zinc-200">{comment.message}</p>
                    ) : null}
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
            <label htmlFor="project-chat-message" className="sr-only">
              Message
            </label>
            <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileChange} />
            <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
              <button
                type="button"
                className="inline-flex h-12 w-12 shrink-0 items-center justify-center self-start rounded-2xl bg-white text-zinc-600 shadow-sm ring-1 ring-zinc-200 transition hover:-translate-y-0.5 hover:text-zinc-950 hover:ring-zinc-300 disabled:opacity-50 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-800 dark:hover:text-zinc-50 dark:hover:ring-zinc-700 sm:h-auto sm:min-h-12"
                onClick={() => fileInputRef.current?.click()}
                disabled={isSubmitting}
                aria-label="Attach files"
                title="Attach files"
              >
                <PaperclipIcon />
              </button>

              <div
                className={`min-w-0 flex-1 rounded-3xl bg-zinc-50/80 ring-1 transition dark:bg-zinc-900/70 ${
                  isDragging
                    ? "ring-4 ring-zinc-300 dark:ring-zinc-700"
                    : "ring-zinc-200 focus-within:ring-zinc-400 dark:ring-zinc-800 dark:focus-within:ring-zinc-600"
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
                  placeholder="Write a message..."
                  rows={2}
                  className="min-h-12 w-full resize-none rounded-3xl border-0 bg-transparent px-4 py-3 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100"
                />
                {selectedAttachments.length > 0 ? (
                  <div className="px-3 pb-3">
                    <div className="flex max-h-24 flex-wrap gap-2 overflow-y-auto pr-1">
                      {selectedAttachments.map((attachment) => (
                        <div key={attachment.id} className="flex max-w-full items-center gap-2 rounded-full bg-white px-2.5 py-1.5 text-xs shadow-sm ring-1 ring-zinc-200 dark:bg-zinc-950 dark:ring-zinc-800">
                          <span className="max-w-44 truncate font-medium text-zinc-800 dark:text-zinc-100">{attachment.file.name}</span>
                          <span className="shrink-0 text-zinc-500">{formatFileSize(attachment.file.size)}</span>
                          <button
                            type="button"
                            onClick={() => removeSelectedAttachment(attachment.id)}
                            className="shrink-0 rounded-full px-1.5 py-0.5 font-semibold text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                            aria-label={`Remove ${attachment.file.name}`}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>

              <button type="submit" className={`${uiPrimaryButtonClass} h-12 shrink-0 self-start px-5 sm:h-auto sm:min-h-12`} disabled={isSubmitting}>
                {isSubmitting ? "Sending..." : "Send message"}
              </button>
            </div>
            <div className="mt-3 min-h-5">
              {error ? <p className="text-sm font-medium text-red-600 dark:text-red-400">{error}</p> : null}
            </div>
          </div>
        </form>
      </div>

      <ConfirmDialog
        open={Boolean(deleteTargetId)}
        title="Delete message?"
        message="This removes your message and hides its attachments from the project chat. This cannot be undone."
        confirmLabel="Delete message"
        loading={Boolean(deleteTargetId && mutatingCommentId === deleteTargetId)}
        onCancel={() => setDeleteTargetId(null)}
        onConfirm={() => void deleteMessage()}
      />
    </>
  );
}
