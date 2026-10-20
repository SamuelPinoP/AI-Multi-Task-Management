"use client";

import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
  type TouchEvent as ReactTouchEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import {
  type AttachmentKind,
  attachmentKind,
  attachmentTypeLabel,
  attachmentUrls,
  canPreviewKind,
  extensionLabel,
  formatDuration,
  formatFileSize,
  isMediaKind,
  mediaGridLayout,
  type MediaTileLayout,
  parseCsv,
  textFormat,
} from "@/lib/project-chat-attachment-display";
import { loadPdfDocument, pdfPageAspect, renderPdfPage } from "@/lib/pdf-client";

export type ChatAttachment = {
  id: string;
  originalName: string;
  fileType: string;
  fileSize: number;
  /** Object URL of the local file while its message is still sending. */
  localUrl?: string;
  /** Upload progress from 0 to 1 while sending. */
  progress?: number;
};

type GalleryItem = {
  attachment: ChatAttachment;
  kind: AttachmentKind;
  /** Inline URL: the local copy while sending, the stored file afterwards. */
  src: string;
  downloadUrl: string;
  previewUrl: string;
  pending: boolean;
};

const TEXT_PREVIEW_LIMIT = 512 * 1024;

const COL_SPAN_CLASS: Record<MediaTileLayout["colSpan"], string> = {
  2: "col-span-2",
  3: "col-span-3",
  6: "col-span-6",
};

const ASPECT_CLASS: Record<MediaTileLayout["aspect"], string> = {
  wide: "aspect-video",
  landscape: "aspect-[4/3]",
  square: "aspect-square",
};

function toGalleryItem(attachment: ChatAttachment, projectId: string): GalleryItem {
  const urls = attachmentUrls(projectId, attachment.id);
  return {
    attachment,
    kind: attachmentKind(attachment.fileType, attachment.originalName),
    src: attachment.localUrl ?? urls.view,
    downloadUrl: urls.download,
    previewUrl: urls.preview,
    pending: Boolean(attachment.localUrl),
  };
}

/** Media fragment that makes browsers paint a first frame as the poster. */
function posterSrc(src: string) {
  return `${src}#t=0.1`;
}

function scrollParent(element: Element) {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll") return node;
  }
  return null;
}

/** Sets `true` once the element has come near the visible area, then stays true. */
function useNearViewport<T extends Element>(ref: RefObject<T | null>) {
  const [near, setNear] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element || near) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      // Observe within the chat's own scroller: the margin only applies to the
      // root, so with the page viewport as root nothing would load early.
      { root: scrollParent(element), rootMargin: "300px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [near, ref]);

  return near;
}

// ---------------------------------------------------------------------------
// Icons

function Icon({ path, className = "h-4 w-4" }: { path: string; className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path d={path} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const DOWNLOAD_PATH = "M10 3.5v9m0 0-3.5-3.5M10 12.5l3.5-3.5M4 15.5h12";
const EXTERNAL_PATH = "M11.5 3.5h5v5m0-5-7 7M8.5 4.5H5A1.5 1.5 0 0 0 3.5 6v9A1.5 1.5 0 0 0 5 16.5h9a1.5 1.5 0 0 0 1.5-1.5v-3.5";
const CLOSE_PATH = "m5 5 10 10M15 5 5 15";
const PREV_PATH = "M12.5 4.5 7 10l5.5 5.5";
const NEXT_PATH = "M7.5 4.5 13 10l-5.5 5.5";

function PlayGlyph({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M8 5.14v13.72a1 1 0 0 0 1.52.85l11.05-6.86a1 1 0 0 0 0-1.7L9.52 4.29A1 1 0 0 0 8 5.14Z" />
    </svg>
  );
}

function Spinner({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className={`animate-spin ${className}`}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

const BADGE_COLORS: Record<AttachmentKind, string> = {
  image: "bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300",
  video: "bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300",
  pdf: "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300",
  docx: "bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300",
  word: "bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300",
  spreadsheet: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
  presentation: "bg-orange-100 text-orange-700 dark:bg-orange-950/60 dark:text-orange-300",
  text: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200",
  archive: "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
  file: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200",
};

/** A small document-shaped badge carrying the file extension. */
function FileBadge({ kind, fileName, size = "md" }: { kind: AttachmentKind; fileName: string; size?: "sm" | "md" | "lg" }) {
  const sizeClass =
    size === "lg" ? "h-24 w-20 rounded-2xl text-base" : size === "sm" ? "h-9 w-8 rounded-lg text-[9px]" : "h-11 w-10 rounded-xl text-[10px]";
  return (
    <span
      aria-hidden="true"
      className={`relative inline-flex shrink-0 items-end justify-center pb-1.5 font-bold tracking-wide ${sizeClass} ${BADGE_COLORS[kind]}`}
    >
      <span className="absolute right-0 top-0 h-1/4 w-1/4 rounded-bl-md bg-black/10 dark:bg-white/10" />
      {extensionLabel(fileName).slice(0, 4)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Message gallery

/**
 * All attachments of one chat message: photos and videos in a grid, documents
 * as preview cards, and an in-chat viewer for each.
 */
export function AttachmentGallery({ attachments, projectId }: { attachments: ChatAttachment[]; projectId: string }) {
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const items = attachments.map((attachment) => toGalleryItem(attachment, projectId));
  const media = items.filter((item) => isMediaKind(item.kind));
  const documents = items.filter((item) => !isMediaKind(item.kind));
  // The viewer steps through items in the order they're shown.
  const ordered = [...media, ...documents];
  const layout = mediaGridLayout(media.length);

  return (
    <div className="mt-3 flex flex-col gap-2">
      {media.length > 0 ? (
        <div
          className={`grid w-full grid-cols-6 gap-1 overflow-hidden rounded-2xl ring-1 ring-zinc-200/80 dark:ring-zinc-800 ${
            media.length === 1 ? "max-w-xl" : "max-w-2xl"
          }`}
        >
          {media.map((item, index) => (
            <MediaTile
              key={item.attachment.id}
              item={item}
              layout={layout[index]}
              single={media.length === 1}
              onOpen={() => setViewerIndex(index)}
            />
          ))}
        </div>
      ) : null}
      {documents.length > 0 ? (
        <div className={`grid w-full max-w-2xl gap-2 ${documents.length > 1 ? "sm:grid-cols-2" : "sm:max-w-sm"}`}>
          {documents.map((item, index) => (
            <DocumentCard key={item.attachment.id} item={item} onOpen={() => setViewerIndex(media.length + index)} />
          ))}
        </div>
      ) : null}
      {viewerIndex !== null && ordered[viewerIndex] ? (
        <AttachmentViewer
          items={ordered}
          index={viewerIndex}
          onIndexChange={setViewerIndex}
          onClose={() => setViewerIndex(null)}
        />
      ) : null}
    </div>
  );
}

function UploadOverlay({ progress }: { progress?: number }) {
  const percent = progress === undefined ? null : Math.round(progress * 100);
  return (
    <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/45 text-white">
      <Spinner className="h-7 w-7" />
      <span className="text-xs font-semibold tabular-nums">{percent === null ? "Uploading" : `${percent}%`}</span>
      {percent !== null ? (
        <span className="absolute inset-x-0 bottom-0 h-1 bg-white/25">
          <span className="block h-full bg-white transition-[width]" style={{ width: `${percent}%` }} />
        </span>
      ) : null}
    </span>
  );
}

function MediaTile({
  item,
  layout,
  single,
  onOpen,
}: {
  item: GalleryItem;
  layout: MediaTileLayout;
  single: boolean;
  onOpen: () => void;
}) {
  const ref = useRef<HTMLButtonElement | null>(null);
  const near = useNearViewport(ref);
  const [duration, setDuration] = useState("");
  const [failed, setFailed] = useState(false);
  const { attachment, kind, src, pending } = item;
  const isVideo = kind === "video";
  const fit = single ? "object-contain" : "object-cover";

  return (
    <button
      ref={ref}
      type="button"
      onClick={onOpen}
      disabled={pending}
      aria-label={`${isVideo ? "Play" : "Open"} ${attachment.originalName}`}
      title={attachment.originalName}
      className={`group relative overflow-hidden bg-zinc-900 text-left outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-sky-400 disabled:cursor-progress ${COL_SPAN_CLASS[layout.colSpan]} ${
        single && !isVideo ? "aspect-[16/10]" : ASPECT_CLASS[layout.aspect]
      }`}
    >
      {near && !failed ? (
        isVideo ? (
          <video
            src={posterSrc(src)}
            preload="metadata"
            muted
            playsInline
            tabIndex={-1}
            aria-hidden="true"
            onLoadedMetadata={(event) => setDuration(formatDuration(event.currentTarget.duration))}
            onError={() => setFailed(true)}
            className={`pointer-events-none absolute inset-0 h-full w-full ${fit} transition duration-300 group-hover:scale-[1.03]`}
          />
        ) : (
          <>
            {single ? (
              // A blurred copy fills the frame so photos of any shape look intentional.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={src} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full scale-110 object-cover opacity-60 blur-2xl" />
            ) : null}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt={attachment.originalName}
              decoding="async"
              onError={() => setFailed(true)}
              className={`absolute inset-0 h-full w-full ${fit} transition duration-300 group-hover:scale-[1.03]`}
            />
          </>
        )
      ) : null}
      {failed ? (
        <span className="absolute inset-0 flex items-center justify-center bg-zinc-800">
          <FileBadge kind={kind} fileName={attachment.originalName} />
        </span>
      ) : null}
      {isVideo ? (
        <>
          <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 via-black/0 to-black/10" />
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span
              className={`flex items-center justify-center rounded-full bg-white/95 text-zinc-950 shadow-xl ring-1 ring-black/10 transition duration-200 group-hover:scale-110 ${
                layout.colSpan === 2 ? "h-11 w-11" : "h-14 w-14"
              }`}
            >
              <PlayGlyph className={layout.colSpan === 2 ? "ml-0.5 h-5 w-5" : "ml-1 h-6 w-6"} />
            </span>
          </span>
          <span className="pointer-events-none absolute inset-x-2 bottom-2 flex items-center justify-between gap-2 text-xs font-medium text-white">
            <span className="truncate drop-shadow">{attachment.originalName}</span>
            {duration ? <span className="shrink-0 rounded-md bg-black/65 px-1.5 py-0.5 tabular-nums">{duration}</span> : null}
          </span>
        </>
      ) : (
        <span className="pointer-events-none absolute inset-0 bg-black/0 transition group-hover:bg-black/10" />
      )}
      {pending ? <UploadOverlay progress={attachment.progress} /> : null}
    </button>
  );
}

function DocumentCard({ item, onOpen }: { item: GalleryItem; onOpen: () => void }) {
  const { attachment, kind, pending } = item;
  const [pages, setPages] = useState<number | null>(null);
  const hasThumbnail = kind === "pdf" || (kind === "docx" && !pending);

  return (
    <div className="group relative overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-zinc-200 transition hover:-translate-y-0.5 hover:shadow-md hover:ring-zinc-300 dark:bg-zinc-900 dark:ring-zinc-800 dark:hover:ring-zinc-700">
      <button
        type="button"
        onClick={onOpen}
        disabled={pending}
        aria-label={`Open ${attachment.originalName}`}
        className="block w-full text-left outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-sky-400 disabled:cursor-progress"
      >
        {hasThumbnail ? (
          <span className="relative block aspect-[16/9] overflow-hidden bg-zinc-100 dark:bg-zinc-800/70">
            {kind === "pdf" ? (
              <PdfThumbnail src={item.src} kind={kind} fileName={attachment.originalName} onPages={setPages} />
            ) : (
              <DocxThumbnail src={item.previewUrl} title={attachment.originalName} />
            )}
            {pending ? <UploadOverlay progress={attachment.progress} /> : null}
          </span>
        ) : null}
        <span className="flex items-center gap-3 p-3 pr-14">
          <span className="relative">
            <FileBadge kind={kind} fileName={attachment.originalName} />
            {pending && !hasThumbnail ? (
              <span className="absolute inset-0 flex items-center justify-center rounded-xl bg-white/70 text-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200">
                <Spinner className="h-5 w-5" />
              </span>
            ) : null}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">{attachment.originalName}</span>
            <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
              {attachmentTypeLabel(kind, attachment.originalName)} · {formatFileSize(attachment.fileSize)}
              {pages ? ` · ${pages} page${pages === 1 ? "" : "s"}` : ""}
              {pending && attachment.progress !== undefined ? ` · ${Math.round(attachment.progress * 100)}%` : ""}
            </span>
          </span>
        </span>
      </button>
      {!pending ? (
        <a
          href={item.downloadUrl}
          download={attachment.originalName}
          aria-label={`Download ${attachment.originalName}`}
          title="Download"
          className="absolute bottom-3 right-3 inline-flex h-9 w-9 items-center justify-center rounded-xl text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
        >
          <Icon path={DOWNLOAD_PATH} />
        </a>
      ) : null}
    </div>
  );
}

/** First page of a PDF, drawn by pdf.js; falls back to a badge if it can't load. */
function PdfThumbnail({
  src,
  kind,
  fileName,
  onPages,
}: {
  src: string;
  kind: AttachmentKind;
  fileName: string;
  onPages: (pages: number) => void;
}) {
  const frameRef = useRef<HTMLSpanElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const near = useNearViewport(frameRef);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");

  useEffect(() => {
    if (!near) return;
    let cancelled = false;
    let task: RenderTask | null = null;

    (async () => {
      try {
        const doc = await loadPdfDocument(src);
        if (cancelled) return;
        onPages(doc.numPages);
        const canvas = canvasRef.current;
        const width = canvas?.parentElement?.clientWidth;
        if (!canvas || !width) return;
        task = await renderPdfPage(doc, 1, canvas, width);
        if (cancelled) {
          task.cancel();
          return;
        }
        await task.promise;
        if (!cancelled) setState("ready");
      } catch {
        if (!cancelled) setState("failed");
      }
    })();

    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [near, onPages, src]);

  return (
    <span ref={frameRef} className="absolute inset-0 block">
      <span
        className={`absolute inset-x-5 top-4 bottom-0 overflow-hidden rounded-t-lg bg-white shadow-lg ring-1 ring-black/5 transition-opacity duration-300 ${
          state === "ready" ? "opacity-100" : "opacity-0"
        }`}
      >
        <canvas ref={canvasRef} className="block w-full" />
      </span>
      {state !== "ready" ? (
        <span className="absolute inset-0 flex items-center justify-center text-zinc-400">
          {state === "loading" ? <Spinner /> : <FileBadge kind={kind} fileName={fileName} size="lg" />}
        </span>
      ) : null}
    </span>
  );
}

/** First page of a Word document, from the server's HTML preview scaled down. */
function DocxThumbnail({ src, title }: { src: string; title: string }) {
  const frameRef = useRef<HTMLSpanElement | null>(null);
  const near = useNearViewport(frameRef);
  const [loaded, setLoaded] = useState(false);

  return (
    <span ref={frameRef} className="absolute inset-0 block">
      {near ? (
        <iframe
          src={src}
          title={`Preview of ${title}`}
          sandbox=""
          tabIndex={-1}
          aria-hidden="true"
          onLoad={() => setLoaded(true)}
          className={`pointer-events-none absolute left-0 top-0 origin-top-left border-0 transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}
          style={{ width: "250%", height: "250%", transform: "scale(0.4)" }}
        />
      ) : null}
      {!loaded ? (
        <span className="absolute inset-0 flex items-center justify-center text-zinc-400">
          <Spinner />
        </span>
      ) : null}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Viewer

const viewerButtonClass =
  "inline-flex h-10 items-center justify-center gap-2 rounded-xl px-3 text-sm font-medium text-white/85 transition hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white";

/** Full-screen, in-chat viewer for one message's attachments. */
export function AttachmentViewer({
  items,
  index,
  onIndexChange,
  onClose,
}: {
  items: GalleryItem[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const touchStartX = useRef<number | null>(null);
  const item = items[index];
  const count = items.length;
  const { attachment, kind } = item;

  const step = useCallback(
    (delta: number) => {
      if (count < 2) return;
      onIndexChange((index + delta + count) % count);
    },
    [count, index, onIndexChange],
  );

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus?.();
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      const target = event.target as HTMLElement | null;
      // Arrow keys seek inside a focused video and move inside form fields.
      if (target?.closest("video, input, textarea, select")) return;
      if (event.key === "ArrowLeft") step(-1);
      if (event.key === "ArrowRight") step(1);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, step]);

  function trapFocus(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab" || !dialogRef.current) return;
    const focusable = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), video[controls], iframe, [tabindex]:not([tabindex='-1'])"),
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function handleTouchEnd(event: ReactTouchEvent) {
    const startX = touchStartX.current;
    touchStartX.current = null;
    if (startX === null) return;
    const deltaX = event.changedTouches[0].clientX - startX;
    if (Math.abs(deltaX) > 60) step(deltaX < 0 ? 1 : -1);
  }

  return createPortal(
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={`${attachment.originalName}${count > 1 ? `, ${index + 1} of ${count}` : ""}`}
      onKeyDown={trapFocus}
      className="fixed inset-0 z-[70] flex flex-col bg-zinc-950/95 text-white backdrop-blur-sm"
    >
      <header className="flex items-center gap-3 border-b border-white/10 px-3 py-2 sm:px-5">
        <FileBadge kind={kind} fileName={attachment.originalName} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{attachment.originalName}</p>
          <p className="truncate text-xs text-white/60">
            {attachmentTypeLabel(kind, attachment.originalName)} · {formatFileSize(attachment.fileSize)}
            {count > 1 ? ` · ${index + 1} of ${count}` : ""}
          </p>
        </div>
        {!item.pending ? (
          <>
            <a href={item.src} target="_blank" rel="noopener noreferrer" className={viewerButtonClass} title="Open in a new tab" aria-label="Open in a new tab">
              <Icon path={EXTERNAL_PATH} />
              <span className="hidden sm:inline">Open</span>
            </a>
            <a href={item.downloadUrl} download={attachment.originalName} className={viewerButtonClass} title="Download" aria-label={`Download ${attachment.originalName}`}>
              <Icon path={DOWNLOAD_PATH} />
              <span className="hidden sm:inline">Download</span>
            </a>
          </>
        ) : null}
        <button ref={closeRef} type="button" onClick={onClose} className={viewerButtonClass} aria-label="Close preview" title="Close (Esc)">
          <Icon path={CLOSE_PATH} className="h-5 w-5" />
        </button>
      </header>

      <div
        className="relative flex min-h-0 flex-1 items-center justify-center p-2 sm:px-20 sm:py-4"
        onTouchStart={(event) => {
          touchStartX.current = event.touches[0].clientX;
        }}
        onTouchEnd={handleTouchEnd}
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <ViewerStage key={attachment.id} item={item} />
        {count > 1 ? (
          <>
            <button
              type="button"
              onClick={() => step(-1)}
              aria-label="Previous attachment"
              className="absolute left-2 top-1/2 hidden h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white shadow-lg ring-1 ring-white/15 backdrop-blur transition hover:bg-white/20 sm:flex"
            >
              <Icon path={PREV_PATH} className="h-6 w-6" />
            </button>
            <button
              type="button"
              onClick={() => step(1)}
              aria-label="Next attachment"
              className="absolute right-2 top-1/2 hidden h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white shadow-lg ring-1 ring-white/15 backdrop-blur transition hover:bg-white/20 sm:flex"
            >
              <Icon path={NEXT_PATH} className="h-6 w-6" />
            </button>
          </>
        ) : null}
      </div>

      {count > 1 ? (
        <nav aria-label="Attachments in this message" className="flex justify-center gap-2 overflow-x-auto border-t border-white/10 px-3 py-3">
          {items.map((entry, entryIndex) => (
            <ViewerThumb
              key={entry.attachment.id}
              item={entry}
              active={entryIndex === index}
              onSelect={() => onIndexChange(entryIndex)}
            />
          ))}
        </nav>
      ) : null}
    </div>,
    document.body,
  );
}

function ViewerThumb({ item, active, onSelect }: { item: GalleryItem; active: boolean; onSelect: () => void }) {
  const { attachment, kind, src } = item;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={`Show ${attachment.originalName}`}
      aria-current={active ? "true" : undefined}
      className={`relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-zinc-800 transition ${
        active ? "ring-2 ring-white" : "opacity-55 ring-1 ring-white/15 hover:opacity-90"
      }`}
    >
      {kind === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : kind === "video" ? (
        <>
          <video src={posterSrc(src)} preload="metadata" muted playsInline tabIndex={-1} aria-hidden="true" className="pointer-events-none h-full w-full object-cover" />
          <span className="absolute inset-0 flex items-center justify-center bg-black/25">
            <PlayGlyph className="h-4 w-4" />
          </span>
        </>
      ) : (
        <span className="flex h-full w-full items-center justify-center">
          <FileBadge kind={kind} fileName={attachment.originalName} size="sm" />
        </span>
      )}
    </button>
  );
}

function ViewerStage({ item }: { item: GalleryItem }) {
  const { attachment, kind, src } = item;

  if (kind === "image") return <ViewerImage src={src} alt={attachment.originalName} />;
  if (kind === "video") return <ViewerVideo src={src} item={item} />;
  if (kind === "pdf") return <ViewerPdf src={src} title={attachment.originalName} />;
  if (kind === "docx" && !item.pending) {
    return (
      <iframe
        src={item.previewUrl}
        title={`Preview of ${attachment.originalName}`}
        sandbox=""
        className="h-full w-full max-w-5xl rounded-xl border-0 bg-zinc-100 shadow-2xl"
      />
    );
  }
  if (kind === "text") return <ViewerText item={item} />;
  return <NoPreview item={item} />;
}

function NoPreview({ item, message }: { item: GalleryItem; message?: string }) {
  const { attachment, kind } = item;
  return (
    <div className="flex max-w-sm flex-col items-center gap-4 rounded-2xl bg-white/5 px-8 py-10 text-center ring-1 ring-white/10">
      <FileBadge kind={kind} fileName={attachment.originalName} size="lg" />
      <div>
        <p className="break-all text-base font-semibold">{attachment.originalName}</p>
        <p className="mt-1 text-sm text-white/60">
          {message ??
            (canPreviewKind(kind)
              ? "This file couldn't be shown here."
              : `${attachmentTypeLabel(kind, attachment.originalName)} files can't be previewed in the chat.`)}
        </p>
      </div>
      {!item.pending ? (
        <div className="flex flex-wrap justify-center gap-2">
          <a
            href={item.downloadUrl}
            download={attachment.originalName}
            className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-200"
          >
            <Icon path={DOWNLOAD_PATH} />
            Download
          </a>
          <a
            href={item.src}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white ring-1 ring-white/25 transition hover:bg-white/10"
          >
            <Icon path={EXTERNAL_PATH} />
            Open in new tab
          </a>
        </div>
      ) : null}
    </div>
  );
}

function ViewerImage({ src, alt }: { src: string; alt: string }) {
  const [zoomed, setZoomed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  return (
    <div className={`relative flex h-full w-full ${zoomed ? "overflow-auto" : "items-center justify-center"}`}>
      {!loaded ? (
        <span className="absolute inset-0 flex items-center justify-center text-white/70">
          <Spinner className="h-8 w-8" />
        </span>
      ) : null}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        onLoad={() => setLoaded(true)}
        onClick={() => setZoomed((value) => !value)}
        className={`select-none rounded-lg shadow-2xl transition-opacity duration-200 ${loaded ? "opacity-100" : "opacity-0"} ${
          zoomed ? "m-auto max-h-none max-w-none cursor-zoom-out" : "max-h-full max-w-full cursor-zoom-in object-contain"
        }`}
      />
    </div>
  );
}

/**
 * Plays the original file at full quality. Stored files come from short-lived
 * signed URLs, so a failed load is retried with a fresh URL, resuming where it
 * stopped.
 */
function ViewerVideo({ src, item }: { src: string; item: GalleryItem }) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const resumeAt = useRef(0);
  const canRetry = !src.startsWith("blob:");
  const url = attempt === 0 || !canRetry ? src : `${src}${src.includes("?") ? "&" : "?"}retry=${attempt}`;

  if (failed) {
    return <NoPreview item={item} message="This video can't play in this browser. Download it to watch it in a video player." />;
  }

  return (
    <video
      key={url}
      src={url}
      controls
      autoPlay
      playsInline
      preload="auto"
      onLoadedMetadata={(event) => {
        if (resumeAt.current > 0) event.currentTarget.currentTime = resumeAt.current;
      }}
      onError={(event) => {
        const error = event.currentTarget.error;
        const unsupported = error?.code === MediaError.MEDIA_ERR_DECODE;
        if (canRetry && !unsupported && attempt < 2) {
          resumeAt.current = event.currentTarget.currentTime || resumeAt.current;
          setAttempt((value) => value + 1);
        } else {
          setFailed(true);
        }
      }}
      className="max-h-full max-w-full rounded-xl bg-black shadow-2xl outline-none"
    />
  );
}

function ViewerPdf({ src, title }: { src: string; title: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [aspect, setAspect] = useState(0.77);
  const [failed, setFailed] = useState(false);
  const [fitWidth, setFitWidth] = useState(0);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    let cancelled = false;
    loadPdfDocument(src)
      .then(async (loaded) => {
        const firstAspect = await pdfPageAspect(loaded, 1);
        if (cancelled) return;
        setAspect(firstAspect);
        setDoc(loaded);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [src]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // Fit pages to the width, up to a comfortable reading width.
    const update = () => setFitWidth(Math.max(240, Math.min(container.clientWidth - 32, 960)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  if (failed) {
    // pdf.js couldn't load it: fall back to the browser's own PDF viewer.
    return <iframe src={src} title={title} className="h-full w-full max-w-5xl rounded-xl border-0 bg-white shadow-2xl" />;
  }

  const pageWidth = Math.round(fitWidth * zoom);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full overflow-auto">
        {doc && fitWidth > 0 ? (
          <div className="flex min-w-fit flex-col items-center gap-4 p-4">
            {Array.from({ length: doc.numPages }, (_, pageIndex) => (
              <PdfPage key={pageIndex} doc={doc} pageNumber={pageIndex + 1} width={pageWidth} aspect={aspect} />
            ))}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-white/70">
            <Spinner className="h-8 w-8" />
          </div>
        )}
      </div>
      {doc ? (
        <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-zinc-900/90 px-2 py-1 text-sm shadow-xl ring-1 ring-white/15">
          <button
            type="button"
            onClick={() => setZoom((value) => Math.max(0.5, value - 0.25))}
            className="h-8 w-8 rounded-full text-lg leading-none hover:bg-white/10"
            aria-label="Zoom out"
          >
            −
          </button>
          <button
            type="button"
            onClick={() => setZoom(1)}
            className="min-w-14 rounded-full px-2 py-1 text-xs font-semibold tabular-nums hover:bg-white/10"
            aria-label="Fit page"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            onClick={() => setZoom((value) => Math.min(3, value + 0.25))}
            className="h-8 w-8 rounded-full text-lg leading-none hover:bg-white/10"
            aria-label="Zoom in"
          >
            +
          </button>
          <span className="px-2 text-xs text-white/60">
            {doc.numPages} page{doc.numPages === 1 ? "" : "s"}
          </span>
        </div>
      ) : null}
    </div>
  );
}

function PdfPage({ doc, pageNumber, width, aspect }: { doc: PDFDocumentProxy; pageNumber: number; width: number; aspect: number }) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const near = useNearViewport(wrapperRef);
  const [rendered, setRendered] = useState(false);

  useEffect(() => {
    if (!near || !canvasRef.current || width <= 0) return;
    let cancelled = false;
    let task: RenderTask | null = null;
    // Wait for zoom clicks to settle before redrawing.
    const timer = window.setTimeout(async () => {
      try {
        task = await renderPdfPage(doc, pageNumber, canvasRef.current!, width);
        if (cancelled) {
          task.cancel();
          return;
        }
        await task.promise;
        if (!cancelled) setRendered(true);
      } catch {
        // A cancelled render rejects; a newer one replaces it.
      }
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      task?.cancel();
    };
  }, [doc, near, pageNumber, width]);

  return (
    <div
      ref={wrapperRef}
      className="relative shrink-0 overflow-hidden rounded-md bg-white shadow-2xl"
      style={{ width, aspectRatio: rendered ? undefined : String(aspect) }}
    >
      <canvas ref={canvasRef} className="block w-full" aria-label={`Page ${pageNumber}`} />
      {!rendered ? (
        <span className="absolute inset-0 flex items-center justify-center text-zinc-400">
          <Spinner />
        </span>
      ) : null}
    </div>
  );
}

function ViewerText({ item }: { item: GalleryItem }) {
  const [content, setContent] = useState<{ text: string; truncated: boolean } | null>(null);
  const [failed, setFailed] = useState(false);
  const format = textFormat(item.attachment.originalName, item.attachment.fileType);

  useEffect(() => {
    let cancelled = false;
    fetch(item.src)
      .then(async (response) => {
        if (!response.ok) throw new Error(`Text request failed with ${response.status}`);
        const text = await response.text();
        if (!cancelled) setContent({ text: text.slice(0, TEXT_PREVIEW_LIMIT), truncated: text.length > TEXT_PREVIEW_LIMIT });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [item.src]);

  if (failed) return <NoPreview item={item} />;
  if (!content) {
    return (
      <span className="text-white/70">
        <Spinner className="h-8 w-8" />
      </span>
    );
  }

  let body: ReactNode;
  if (format === "csv") {
    const rows = parseCsv(content.text);
    const [header = [], ...rest] = rows;
    body = (
      <table className="min-w-full border-collapse text-left text-xs">
        <thead className="sticky top-0 bg-zinc-100 text-zinc-700">
          <tr>
            {header.map((cell, cellIndex) => (
              <th key={cellIndex} className="border-b border-zinc-200 px-3 py-2 font-semibold">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rest.map((row, rowIndex) => (
            <tr key={rowIndex} className="odd:bg-white even:bg-zinc-50">
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="border-b border-zinc-100 px-3 py-1.5 text-zinc-800">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  } else {
    let text = content.text;
    if (format === "json" && !content.truncated) {
      try {
        text = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        // Show invalid JSON as it is.
      }
    }
    body = <pre className="whitespace-pre-wrap break-words p-5 font-mono text-[13px] leading-6 text-zinc-800">{text}</pre>;
  }

  return (
    <div className="flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
      <div className="min-h-0 flex-1 overflow-auto">{body}</div>
      {content.truncated ? (
        <p className="border-t border-zinc-200 bg-zinc-50 px-4 py-2 text-xs text-zinc-600">Showing the first 512 KB. Download the file to see all of it.</p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Composer

export type ComposerAttachment = { id: string; file: File; previewUrl: string };

/**
 * Previews of picked files are object URLs, which the browser generates as
 * `blob:<origin>/<uuid>`. Refuse anything else so a preview can never be a
 * script URL. encodeURI leaves such URLs unchanged; it marks the value as a
 * URL for code scanning, which otherwise traces the file name into `src`.
 */
function localPreviewUrl(url: string) {
  return url.startsWith("blob:") ? encodeURI(url) : undefined;
}

/** Thumbnails of the files picked for the next message. */
export function ComposerAttachmentTray({
  attachments,
  onRemove,
}: {
  attachments: ComposerAttachment[];
  onRemove: (id: string) => void;
}) {
  return (
    <ul aria-label="Files to send" className="flex gap-3 overflow-x-auto px-3 pb-3 pt-2">
      {attachments.map(({ id, file, previewUrl }) => {
        const kind = attachmentKind(file.type, file.name);
        const preview = localPreviewUrl(previewUrl);
        return (
          <li key={id} className="relative w-24 shrink-0">
            <div className="relative h-20 w-24 overflow-hidden rounded-xl bg-zinc-100 ring-1 ring-zinc-200 dark:bg-zinc-800 dark:ring-zinc-700">
              {kind === "image" && preview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview} alt="" className="h-full w-full object-cover" />
              ) : kind === "video" && preview ? (
                <>
                  <video src={posterSrc(preview)} preload="metadata" muted playsInline aria-hidden="true" className="h-full w-full bg-zinc-900 object-cover" />
                  <span className="absolute inset-0 flex items-center justify-center">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-zinc-950 shadow">
                      <PlayGlyph className="ml-0.5 h-4 w-4" />
                    </span>
                  </span>
                </>
              ) : (
                <span className="flex h-full w-full items-center justify-center">
                  <FileBadge kind={kind} fileName={file.name} />
                </span>
              )}
            </div>
            <p className="mt-1 truncate text-[11px] font-medium text-zinc-800 dark:text-zinc-100" title={file.name}>
              {file.name}
            </p>
            <p className="text-[10px] text-zinc-500">{formatFileSize(file.size)}</p>
            <button
              type="button"
              onClick={() => onRemove(id)}
              aria-label={`Remove ${file.name}`}
              className="absolute -right-2 -top-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-zinc-900 text-white shadow ring-2 ring-white transition hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:ring-zinc-900 dark:hover:bg-zinc-300"
            >
              <Icon path={CLOSE_PATH} className="h-3 w-3" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
