"use client";

import { SendHorizontal } from "lucide-react";
import { ChangeEvent, DragEvent, Fragment, useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { AttachmentGallery, ComposerAttachmentTray } from "@/components/project-chat-attachments";
import { uiButtonClass, uiPrimaryButtonClass } from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatFileSize } from "@/lib/project-chat-attachment-display";
import { isPageIdle, onPageReturn } from "@/lib/use-page-activity";

type ProjectCommentAttachment = {
  id: string;
  fileName: string;
  originalName: string;
  fileType: string;
  fileSize: number;
  url: string;
  createdAt: string;
  /** Object URL of the local file while the message is still sending. */
  localUrl?: string;
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

type AttachmentUploadPlan =
  | { clientId: string; strategy: "multipart"; provider: string }
  | {
      clientId: string;
      strategy: "direct-s3";
      uploadId: string;
      uploadUrl: string;
      uploadMethod: "PUT";
      uploadHeaders: Record<string, string>;
      expiresAt: string;
    };

const MAX_FILES_PER_MESSAGE = 5;
// How often an open, visible chat checks for teammates' messages, until ten minutes without activity.
const CHAT_REFRESH_MS = 7000;
const STANDARD_FILE_SIZE_LIMIT = 10 * 1024 * 1024;
const VIDEO_FILE_SIZE_LIMIT = 100 * 1024 * 1024;
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".webm", ".m4v"]);
const ACCEPTED_FILE_TYPES =
  ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.json,.png,.jpg,.jpeg,.gif,.webp,.mp4,.mov,.webm,.m4v,.zip";
// The message box grows with its text, like WhatsApp's: up to 6 lines on a phone and 10 on wider
// screens, never past 40% of the screen's height, then it scrolls. The textarea and an invisible
// copy of its text share these classes and one grid cell, so the copy sets the height and the
// textarea stretches to it. Phones get 16px text, so iOS doesn't zoom in when the box is tapped.
const COMPOSER_TEXT_CLASS =
  "col-start-1 row-start-1 max-h-[min(calc(6lh+1rem),40dvh)] px-4 py-2 text-base sm:max-h-[min(calc(10lh+1rem),40dvh)] sm:text-sm";

function getFileExtension(fileName: string) {
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex >= 0 ? fileName.slice(dotIndex).toLowerCase() : "";
}

function isVideoFile(file: File) {
  return (
    file.type.startsWith("video/") ||
    VIDEO_EXTENSIONS.has(getFileExtension(file.name))
  );
}

function fileSizeLimit(file: File) {
  return isVideoFile(file) ? VIDEO_FILE_SIZE_LIMIT : STANDARD_FILE_SIZE_LIMIT;
}

/** Like fetch, but reports upload progress, which fetch can't. */
function sendWithProgress(
  url: string,
  init: { method: string; headers?: Record<string, string>; body: XMLHttpRequestBodyInit },
  onProgress: (fraction: number) => void,
) {
  return new Promise<Response>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(init.method, url);
    for (const [name, value] of Object.entries(init.headers ?? {})) {
      xhr.setRequestHeader(name, value);
    }
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      const hasBody = ![204, 205, 304].includes(xhr.status);
      resolve(
        new Response(hasBody ? xhr.responseText : null, {
          status: xhr.status,
          headers: { "Content-Type": xhr.getResponseHeader("Content-Type") || "text/plain" },
        }),
      );
    };
    xhr.onerror = () => reject(new Error("The upload was interrupted. Check your connection and try again."));
    xhr.onabort = () => reject(new Error("The upload was cancelled."));
    xhr.send(init.body);
  });
}

function isEdited(comment: ProjectComment) {
  return (
    new Date(comment.updatedAt).getTime() -
      new Date(comment.createdAt).getTime() >
    1000
  );
}

/** "Oct 29, 5:13 PM", short enough for a phone; the full date and time show on hover. */
function formatMessageTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function PinIcon({
  filled = false,
  className = "h-3.5 w-3.5",
}: {
  filled?: boolean;
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.7"
      className={className}
    >
      <path
        d="M6.75 3.25h6.5l-1.1 5.1 2.35 2.35v1.05H10.8L10 17l-.8-5.25H5.5V10.7l2.35-2.35-1.1-5.1Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PaperclipIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className={className}
    >
      <path
        d="m7.25 10.75 4.7-4.7a2.35 2.35 0 0 1 3.32 3.32l-5.55 5.55a4 4 0 0 1-5.66-5.66l5.75-5.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ProjectChatWorkspace({
  projectId,
  initialComments,
  currentUser,
  readOnly = false,
  attachmentsDisabledMessage,
  newSince,
  framed = true,
}: {
  projectId: string;
  initialComments: ProjectComment[];
  currentUser: CurrentUser;
  readOnly?: boolean;
  /** Shown instead of accepting files when this user can't upload. */
  attachmentsDisabledMessage?: string;
  /** When the user last read this chat: a "New messages" line goes above the first later message from someone else. */
  newSince?: string;
  /** A card frame from sm up, for a chat on its own page; off where a pane already frames it (the Chats page). */
  framed?: boolean;
}) {
  const [comments, setComments] = useState(initialComments);
  // Fixed when the chat opens, so the line stays put while the user replies.
  const [firstNewCommentId] = useState(() => {
    if (!newSince) return null;
    const since = Date.parse(newSince);
    return (
      initialComments.find(
        (comment) => Date.parse(comment.createdAt) > since && comment.author.email !== currentUser.email,
      )?.id ?? null
    );
  });
  const [message, setMessage] = useState("");
  const [selectedAttachments, setSelectedAttachments] = useState<
    SelectedAttachment[]
  >([]);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editMessage, setEditMessage] = useState("");
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [mutatingCommentId, setMutatingCommentId] = useState<string | null>(
    null,
  );
  // Upload progress (0 to 1) of the message being sent, by pending attachment id.
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>(
    {},
  );
  const threadRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Whether the reader is at the bottom of the thread; only then do new messages scroll it.
  const nearBottomRef = useRef(true);
  const chatVersionRef = useRef<string | null>(null);
  const busyRef = useRef(false);

  useEffect(() => {
    busyRef.current = isSubmitting || mutatingCommentId !== null;
  }, [isSubmitting, mutatingCommentId]);

  useEffect(() => {
    const ownMessageSending = comments.at(-1)?.id.startsWith("pending-");
    if (nearBottomRef.current || ownMessageSending) {
      messagesEndRef.current?.scrollIntoView({ block: "end" });
    }
  }, [comments]);

  // The thread gets shorter as the message box grows; a reader at the bottom stays at the latest message.
  useEffect(() => {
    const thread = threadRef.current;
    if (!thread) return;
    const observer = new ResizeObserver(() => {
      if (nearBottomRef.current) thread.scrollTop = thread.scrollHeight;
    });
    observer.observe(thread);
    return () => observer.disconnect();
  }, []);

  // Picks up teammates' messages, edits, deletes and pins while the chat is open.
  useEffect(() => {
    let stopped = false;

    async function refresh() {
      // Nobody reading for ten minutes: skip the checks, so the database can sleep. Coming back checks at once.
      if (document.visibilityState !== "visible" || busyRef.current || isPageIdle()) return;
      try {
        const version = chatVersionRef.current;
        const res = await fetch(
          `/api/projects/${projectId}/comments${version ? `?version=${encodeURIComponent(version)}` : ""}`,
          { cache: "no-store" },
        );
        if (!res.ok || stopped) return;
        const data = (await res.json()) as { version: string; changed: boolean; comments?: ProjectComment[] };
        // Skip the update if a send or edit started meanwhile; the next check catches up.
        if (busyRef.current) return;
        chatVersionRef.current = data.version;
        const fresh = data.comments;
        if (!data.changed || !fresh) return;
        setComments((prev) => [...fresh, ...prev.filter((comment) => comment.id.startsWith("pending-"))]);
        // The reader is looking at the chat, so what just arrived counts as read (SIDE-03).
        void fetch(`/api/projects/${projectId}/chat-read`, { method: "POST" }).catch(() => undefined);
      } catch {
        // Offline or a hiccup: try again on the next tick.
      }
    }

    const timer = window.setInterval(() => void refresh(), CHAT_REFRESH_MS);
    const stopListening = onPageReturn(() => void refresh());
    return () => {
      stopped = true;
      window.clearInterval(timer);
      stopListening();
    };
  }, [projectId]);

  function addFiles(fileList: FileList | File[]) {
    const nextFiles = Array.from(fileList).filter((file) => file.size > 0);
    if (nextFiles.length === 0) return;

    if (attachmentsDisabledMessage) {
      setError(attachmentsDisabledMessage);
      return;
    }

    const availableSlots = MAX_FILES_PER_MESSAGE - selectedAttachments.length;
    if (availableSlots <= 0) {
      setError(
        `You can attach up to ${MAX_FILES_PER_MESSAGE} files per message.`,
      );
      return;
    }

    const oversized = nextFiles.find((file) => file.size > fileSizeLimit(file));
    if (oversized) {
      setError(
        `${oversized.name} is ${formatFileSize(oversized.size)} and exceeds the ${formatFileSize(fileSizeLimit(oversized))} limit for this file type.`,
      );
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
      setError(
        `Only ${availableSlots} more file${availableSlots === 1 ? "" : "s"} could be added.`,
      );
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

  async function prepareAttachmentUploads(attachments: SelectedAttachment[]) {
    if (attachments.length === 0) return new Map<string, AttachmentUploadPlan>();

    const res = await fetch(`/api/projects/${projectId}/attachments/uploads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        files: attachments.map((attachment) => ({
          clientId: attachment.id,
          name: attachment.file.name,
          type: attachment.file.type,
          size: attachment.file.size,
        })),
      }),
    });

    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      throw new Error(data?.error || "Could not prepare attachment upload.");
    }

    const data = (await res.json()) as { files?: AttachmentUploadPlan[] };
    return new Map((data.files || []).map((plan) => [plan.clientId, plan]));
  }

  async function sendMessage() {
    const trimmed = message.trim();
    if (!trimmed && selectedAttachments.length === 0) {
      setError("Add a message or attach at least one file.");
      return;
    }

    const now = new Date().toISOString();
    const optimisticAttachments: ProjectCommentAttachment[] =
      selectedAttachments.map((attachment) => ({
        id: `pending-${attachment.id}`,
        fileName: attachment.file.name,
        originalName: attachment.file.name,
        fileType: attachment.file.type || "application/octet-stream",
        fileSize: attachment.file.size,
        url: attachment.previewUrl,
        localUrl: attachment.previewUrl,
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

    setIsSubmitting(true);
    setError("");
    setMessage("");
    setSelectedAttachments([]);
    setUploadProgress({});
    setComments((prev) => [...prev, optimisticComment]);

    const reportProgress = (attachments: SelectedAttachment[], fraction: number) =>
      setUploadProgress((prev) => {
        const next = { ...prev };
        for (const attachment of attachments) next[`pending-${attachment.id}`] = fraction;
        return next;
      });

    try {
      const uploadPlans = await prepareAttachmentUploads(attachmentsToSend);
      const directUploads: {
        attachment: SelectedAttachment;
        plan: Extract<AttachmentUploadPlan, { strategy: "direct-s3" }>;
      }[] = [];
      const multipartAttachments: SelectedAttachment[] = [];

      for (const attachment of attachmentsToSend) {
        const plan = uploadPlans.get(attachment.id);
        if (!plan) throw new Error("Could not prepare attachment upload.");
        if (plan.strategy === "direct-s3") directUploads.push({ attachment, plan });
        else multipartAttachments.push(attachment);
      }

      // Upload straight to storage, all files at once.
      await Promise.all(
        directUploads.map(async ({ attachment, plan }) => {
          const uploadRes = await sendWithProgress(
            plan.uploadUrl,
            { method: plan.uploadMethod, headers: plan.uploadHeaders, body: attachment.file },
            (fraction) => reportProgress([attachment], fraction),
          );
          if (!uploadRes.ok) {
            throw new Error(`Could not upload ${attachment.file.name}. Try again in a moment.`);
          }
          reportProgress([attachment], 1);
        }),
      );
      const directUploadIds = directUploads.map(({ plan }) => plan.uploadId);

      let res: Response;
      if (multipartAttachments.length > 0) {
        const formData = new FormData();
        formData.append("message", trimmed);
        if (directUploadIds.length > 0) {
          formData.append("preparedAttachmentIds", JSON.stringify(directUploadIds));
        }
        multipartAttachments.forEach((attachment) =>
          formData.append("attachments", attachment.file),
        );
        res = await sendWithProgress(
          `/api/projects/${projectId}/comments`,
          { method: "POST", body: formData },
          (fraction) => reportProgress(multipartAttachments, fraction),
        );
      } else {
        res = await fetch(`/api/projects/${projectId}/comments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: trimmed,
            preparedAttachmentIds: directUploadIds,
          }),
        });
      }

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setComments((prev) =>
          prev.filter((comment) => comment.id !== optimisticComment.id),
        );
        setMessage(trimmed);
        setSelectedAttachments(attachmentsToSend);
        setError(data?.error || "Could not send message.");
        return;
      }

      const created = (await res.json()) as ProjectComment;
      setComments((prev) =>
        prev.map((comment) =>
          comment.id === optimisticComment.id ? created : comment,
        ),
      );
      attachmentsToSend.forEach((attachment) =>
        URL.revokeObjectURL(attachment.previewUrl),
      );
    } catch (error) {
      setComments((prev) =>
        prev.filter((comment) => comment.id !== optimisticComment.id),
      );
      setMessage(trimmed);
      setSelectedAttachments(attachmentsToSend);
      setError(error instanceof Error ? error.message : "Could not send message.");
    } finally {
      setIsSubmitting(false);
      setUploadProgress({});
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
    setComments((prev) =>
      prev.map((item) =>
        item.id === comment.id
          ? { ...item, message: trimmed, updatedAt: optimisticUpdatedAt }
          : item,
      ),
    );

    try {
      const res = await fetch(
        `/api/projects/${projectId}/comments/${comment.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: trimmed }),
        },
      );

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setComments(previousComments);
        setEditingCommentId(comment.id);
        setEditMessage(comment.message);
        setError(data?.error || "Could not edit message.");
        return;
      }

      const updated = (await res.json()) as ProjectComment;
      setComments((prev) =>
        prev.map((item) => (item.id === updated.id ? updated : item)),
      );
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
      const res = await fetch(
        `/api/projects/${projectId}/comments/${commentId}`,
        { method: "DELETE" },
      );

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setComments(previousComments);
        setError(data?.error || "Could not delete message.");
      }
    } finally {
      setMutatingCommentId(null);
    }
  }

  const pinnedComments = comments
    .filter((comment) => comment.pinned && !comment.id.startsWith("pending-"))
    .sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    )
    .slice(0, 3);

  function jumpToComment(commentId: string) {
    document
      .getElementById(`comment-${commentId}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  async function togglePinned(comment: ProjectComment) {
    const previousComments = comments;
    const nextPinned = !comment.pinned;

    setMutatingCommentId(comment.id);
    setError("");
    setComments((prev) =>
      prev.map((item) =>
        item.id === comment.id ? { ...item, pinned: nextPinned } : item,
      ),
    );

    try {
      const res = await fetch(
        `/api/projects/${projectId}/comments/${comment.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pinned: nextPinned }),
        },
      );

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setComments(previousComments);
        setError(data?.error || "Could not update pinned message.");
        return;
      }

      const updated = (await res.json()) as ProjectComment;
      setComments((prev) =>
        prev.map((item) => (item.id === updated.id ? updated : item)),
      );
    } finally {
      setMutatingCommentId(null);
    }
  }

  return (
    <>
      {/* On phones the chat runs edge to edge; the card frame starts at sm. */}
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col overflow-hidden border-zinc-200 bg-white shadow-zinc-200/70 dark:border-zinc-800 dark:bg-zinc-950 dark:shadow-none",
          framed && "sm:rounded-2xl sm:border sm:shadow-xl",
        )}
      >
        {pinnedComments.length > 0 ? (
          <section
            className="bg-white/95 px-3 py-2 dark:bg-zinc-950 sm:px-6 sm:py-3"
            aria-label="Pinned messages"
          >
            <div className="mx-auto max-w-5xl rounded-2xl bg-amber-50/80 p-2.5 ring-1 ring-amber-200/70 dark:bg-amber-950/20 dark:ring-amber-900/60 sm:p-3">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-amber-700 dark:text-amber-300">
                <PinIcon filled className="h-3.5 w-3.5" />
                Pinned messages
              </div>
              {/* One row on phones that scrolls sideways, instead of three stacked cards. */}
              <div className="flex gap-2 overflow-x-auto md:grid md:grid-cols-3 md:overflow-visible">
                {pinnedComments.map((comment) => (
                  <button
                    key={comment.id}
                    type="button"
                    onClick={() => jumpToComment(comment.id)}
                    className="w-56 min-w-0 shrink-0 rounded-xl bg-white/85 px-3 py-2 text-left text-sm shadow-sm transition hover:-translate-y-0.5 hover:bg-white dark:bg-zinc-900/80 dark:hover:bg-zinc-900 md:w-auto"
                  >
                    <span className="block truncate font-medium text-zinc-900 dark:text-zinc-100">
                      {comment.author.name || comment.author.email}
                    </span>
                    <span className="mt-1 block truncate text-xs text-zinc-600 dark:text-zinc-300">
                      {comment.message ||
                        `${comment.attachments.length} attachment${comment.attachments.length === 1 ? "" : "s"}`}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </section>
        ) : null}

        <div
          ref={threadRef}
          className="min-h-0 flex-1 overflow-y-auto bg-zinc-100/60 px-3 py-3 dark:bg-zinc-950 sm:px-6 sm:py-4 lg:px-8"
          onScroll={(event) => {
            const element = event.currentTarget;
            nearBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 120;
          }}
        >
          {/* An empty chat centers its hint in the space instead of hanging it from the top. */}
          <div className={cn("mx-auto flex max-w-5xl flex-col gap-3 sm:gap-4", comments.length === 0 && "min-h-full justify-center")}>
            {comments.length === 0 ? (
              <div className="rounded-2xl bg-white/80 p-5 text-center shadow-sm ring-1 ring-zinc-200/70 dark:bg-zinc-900/70 dark:ring-zinc-800/70 sm:p-8">
                <p className="text-base font-semibold text-zinc-900 dark:text-zinc-100 sm:text-lg">
                  Start the project conversation.
                </p>
                <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-zinc-600 dark:text-zinc-300">
                  Post a kickoff update, decision, blocker, or handoff. Use the
                  paperclip<span className="hidden sm:inline"> or drag files into the composer</span> to share references,
                  screenshots, PDFs, and other project artifacts.
                </p>
              </div>
            ) : (
              comments.map((comment) => {
                const isPending = comment.id.startsWith("pending-");
                const isOwnMessage =
                  comment.author.email === currentUser.email && !isPending;
                const isEditing = editingCommentId === comment.id;
                const isMutating = mutatingCommentId === comment.id;

                return (
                  <Fragment key={comment.id}>
                  {comment.id === firstNewCommentId ? (
                    <div role="separator" aria-label="New messages" className="flex items-center gap-3 text-xs font-bold text-accent">
                      <span aria-hidden="true" className="h-px flex-1 bg-accent" />
                      New messages
                      <span aria-hidden="true" className="h-px flex-1 bg-accent" />
                    </div>
                  ) : null}
                  <article
                    id={`comment-${comment.id}`}
                    className={`rounded-2xl bg-white/95 p-3 text-sm shadow-sm shadow-zinc-200/60 ring-1 transition dark:bg-zinc-900/80 dark:shadow-none sm:p-4 ${
                      isPending
                        ? "opacity-80 ring-zinc-300 dark:ring-zinc-700"
                        : comment.pinned
                          ? "ring-amber-200 dark:ring-amber-900/70"
                          : "ring-zinc-200/70 dark:ring-zinc-800/70"
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
                      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-xs font-semibold uppercase text-white dark:bg-zinc-100 dark:text-zinc-900">
                        {(comment.author.name || comment.author.email).slice(
                          0,
                          1,
                        )}
                      </span>
                      {/* The name, then the time and badges: two short lines, where a phone used to stack four. */}
                      <div className="min-w-0 flex-1">
                        <p className="flex min-w-0 items-center gap-1.5">
                          <span className="truncate font-semibold text-zinc-900 dark:text-zinc-100">
                            {comment.author.name || comment.author.email}
                          </span>
                          {isOwnMessage ? (
                            <span className="shrink-0 text-2xs font-medium uppercase tracking-wide text-zinc-500">
                              You
                            </span>
                          ) : null}
                        </p>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-zinc-500">
                          <time
                            dateTime={comment.createdAt}
                            title={new Date(comment.createdAt).toLocaleString()}
                            className="font-mono tabular-nums"
                          >
                            {formatMessageTime(comment.createdAt)}
                          </time>
                          {comment.pinned ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
                              <PinIcon filled />
                              Pinned
                            </span>
                          ) : null}
                          {isPending ? (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
                              Sending
                            </span>
                          ) : null}
                          {isMutating ? (
                            <span className="rounded-full bg-zinc-100 px-2 py-0.5 font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                              Saving
                            </span>
                          ) : null}
                          {isEdited(comment) ? (
                            <span className="rounded-full bg-zinc-100 px-2 py-0.5 font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-300">
                              Edited
                            </span>
                          ) : null}
                        </div>
                      </div>
                      {/* Icons only on phones; the words come back from sm. */}
                      {isOwnMessage ? (
                        <span className="flex shrink-0 items-center gap-0.5 text-xs">
                          <button
                            type="button"
                            onClick={() => void togglePinned(comment)}
                            disabled={isMutating}
                            className={`inline-flex items-center gap-1 rounded-full p-1.5 font-medium transition disabled:opacity-50 sm:px-2 sm:py-1 ${
                              comment.pinned
                                ? "bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:hover:bg-amber-950"
                                : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                            }`}
                            aria-label={
                              comment.pinned ? "Unpin message" : "Pin message"
                            }
                            title={
                              comment.pinned ? "Unpin message" : "Pin message"
                            }
                          >
                            <PinIcon filled={comment.pinned} />
                            <span className="sr-only sm:not-sr-only">{comment.pinned ? "Unpin" : "Pin"}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => startEditing(comment)}
                            disabled={isMutating}
                            className="inline-flex items-center gap-1 rounded-full p-1.5 font-medium text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-50 dark:hover:bg-zinc-800 dark:hover:text-zinc-100 sm:px-2 sm:py-1"
                          >
                            <svg
                              aria-hidden="true"
                              viewBox="0 0 20 20"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.7"
                              className="h-3.5 w-3.5"
                            >
                              <path
                                d="m4 14.5-.5 2 2-.5 9.25-9.25a1.4 1.4 0 0 0-2-2L4 14.5Z"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                            <span className="sr-only sm:not-sr-only">Edit</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteTargetId(comment.id)}
                            disabled={isMutating}
                            className="inline-flex items-center gap-1 rounded-full p-1.5 font-medium text-red-600 transition hover:bg-red-50 hover:text-red-700 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950/40 dark:hover:text-red-300 sm:px-2 sm:py-1"
                            aria-label="Delete message"
                          >
                            <svg
                              aria-hidden="true"
                              viewBox="0 0 20 20"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.7"
                              className="h-3.5 w-3.5"
                            >
                              <path
                                d="M7 5V3.75A1.25 1.25 0 0 1 8.25 2.5h3.5A1.25 1.25 0 0 1 13 3.75V5m3 0H4m1.25 0 .6 10.4A1.75 1.75 0 0 0 7.6 17h4.8a1.75 1.75 0 0 0 1.75-1.6L14.75 5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                            <span className="sr-only sm:not-sr-only">Delete</span>
                          </button>
                        </span>
                      ) : null}
                    </div>
                    {isEditing ? (
                      <div className="mt-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-950">
                        <label
                          htmlFor={`edit-${comment.id}`}
                          className="sr-only"
                        >
                          Edit message
                        </label>
                        <textarea
                          id={`edit-${comment.id}`}
                          value={editMessage}
                          onChange={(event) =>
                            setEditMessage(event.target.value)
                          }
                          rows={3}
                          className="w-full resize-none rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                        />
                        <div className="mt-3 flex justify-end gap-2">
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
                          <button
                            type="button"
                            className={`${uiPrimaryButtonClass} px-3 py-1.5 text-xs`}
                            onClick={() => void saveEditedMessage(comment)}
                          >
                            Save edit
                          </button>
                        </div>
                      </div>
                    ) : comment.message ? (
                      <p className="mt-2 whitespace-pre-wrap leading-6 text-zinc-800 dark:text-zinc-200 sm:mt-3">
                        {comment.message}
                      </p>
                    ) : null}
                    {comment.attachments.length > 0 ? (
                      <AttachmentGallery
                        projectId={projectId}
                        attachments={
                          isPending
                            ? comment.attachments.map((attachment) => ({
                                ...attachment,
                                progress: uploadProgress[attachment.id],
                              }))
                            : comment.attachments
                        }
                      />
                    ) : null}
                  </article>
                  </Fragment>
                );
              })
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        <form
          className="border-t border-zinc-200 bg-white px-3 py-2 shadow-[0_-12px_35px_rgba(24,24,27,0.08)] dark:border-zinc-800 dark:bg-zinc-950 sm:px-5 lg:px-7"
          onSubmit={(event) => {
            event.preventDefault();
            void sendMessage();
          }}
        >
          <div className="mx-auto max-w-5xl">
            <label htmlFor="project-chat-message" className="sr-only">
              Message
            </label>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ACCEPTED_FILE_TYPES}
              className="hidden"
              onChange={handleFileChange}
            />
            {readOnly ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200 sm:p-4">
                Read-only access: you can review project chat and attachments,
                but only Owners and Editors can post messages or upload files.
              </div>
            ) : (
              // One row at every size: attach, the message box, send. The buttons stay at the bottom as the box grows.
              <div className="flex items-end gap-2">
                <button
                  type="button"
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-zinc-600 shadow-sm ring-1 ring-zinc-200 transition hover:text-zinc-950 hover:ring-zinc-300 disabled:opacity-50 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-800 dark:hover:text-zinc-50 dark:hover:ring-zinc-700 sm:h-9 sm:w-9"
                  onClick={() => {
                    if (attachmentsDisabledMessage) setError(attachmentsDisabledMessage);
                    else fileInputRef.current?.click();
                  }}
                  disabled={isSubmitting}
                  aria-label="Attach files"
                  title="Attach files"
                >
                  <PaperclipIcon />
                </button>

                <div
                  className={`min-w-0 flex-1 rounded-2xl bg-zinc-50/80 ring-1 transition dark:bg-zinc-900/70 ${
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
                  <div className="grid grid-cols-1">
                    <textarea
                      id="project-chat-message"
                      value={message}
                      onChange={(e) => {
                        setMessage(e.target.value);
                        if (error) setError("");
                      }}
                      placeholder="Share an update, decision, blocker, or handoff..."
                      rows={1}
                      // At least two lines on a phone, so the whole hint shows; one line from sm.
                      className={`${COMPOSER_TEXT_CLASS} min-h-[calc(2lh+1rem)] w-full resize-none rounded-2xl border-0 bg-transparent text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100 sm:min-h-[calc(1lh+1rem)]`}
                    />
                    {/* The trailing space gives a final empty line its height. */}
                    <div
                      aria-hidden="true"
                      className={`${COMPOSER_TEXT_CLASS} invisible overflow-hidden whitespace-pre-wrap break-words`}
                    >
                      {`${message} `}
                    </div>
                  </div>
                  {selectedAttachments.length > 0 ? (
                    <ComposerAttachmentTray
                      attachments={selectedAttachments}
                      onRemove={removeSelectedAttachment}
                    />
                  ) : null}
                </div>

                {/* An icon on phones and "Send" from sm; either way its name is "Send message". The message
                    itself shows "Sending" while it uploads. */}
                <button
                  type="submit"
                  className={cn(uiPrimaryButtonClass, "h-10 w-10 shrink-0 px-0 sm:h-9 sm:w-auto sm:px-4")}
                  disabled={isSubmitting}
                >
                  <SendHorizontal aria-hidden="true" className="h-4 w-4" />
                  <span className="sr-only sm:not-sr-only">Send</span>
                  <span className="sr-only"> message</span>
                </button>
              </div>
            )}
            {error ? (
              <div className="mt-2">
                <p className="text-sm font-medium text-red-600 dark:text-red-400">
                  {error}
                </p>
              </div>
            ) : null}
          </div>
        </form>
      </div>

      <ConfirmDialog
        open={Boolean(deleteTargetId)}
        title="Delete message?"
        message="This removes your message and hides its attachments from the project chat. This cannot be undone."
        confirmLabel="Delete message"
        loading={Boolean(
          deleteTargetId && mutatingCommentId === deleteTargetId,
        )}
        onCancel={() => setDeleteTargetId(null)}
        onConfirm={() => void deleteMessage()}
      />
    </>
  );
}
