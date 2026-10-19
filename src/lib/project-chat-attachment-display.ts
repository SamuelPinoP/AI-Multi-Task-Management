// How project chat attachments are presented: kind, labels, gallery layout and URLs.
// Shared by the chat UI and its tests, so it must stay free of browser-only APIs.

export type AttachmentKind =
  | "image"
  | "video"
  | "pdf"
  | "docx"
  | "word"
  | "spreadsheet"
  | "presentation"
  | "text"
  | "archive"
  | "file";

export type TextFormat = "csv" | "json" | "plain";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".webm", ".m4v"]);
const TEXT_EXTENSIONS = new Set([".txt", ".csv", ".json"]);

export function fileExtension(fileName: string) {
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex > 0 ? fileName.slice(dotIndex).toLowerCase() : "";
}

export function attachmentKind(fileType: string, fileName: string): AttachmentKind {
  const type = fileType.toLowerCase();
  const extension = fileExtension(fileName);

  if (type.startsWith("image/") || IMAGE_EXTENSIONS.has(extension)) return "image";
  if (type.startsWith("video/") || VIDEO_EXTENSIONS.has(extension)) return "video";
  if (type === "application/pdf" || extension === ".pdf") return "pdf";
  if (
    extension === ".docx" ||
    type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return "docx";
  }
  if (extension === ".doc" || type === "application/msword") return "word";
  if ([".xls", ".xlsx"].includes(extension)) return "spreadsheet";
  if ([".ppt", ".pptx"].includes(extension)) return "presentation";
  if (TEXT_EXTENSIONS.has(extension) || type.startsWith("text/") || type === "application/json") {
    return "text";
  }
  if (extension === ".zip" || type === "application/zip") return "archive";
  return "file";
}

export function isMediaKind(kind: AttachmentKind): kind is "image" | "video" {
  return kind === "image" || kind === "video";
}

/** Kinds the in-chat viewer can show without downloading the file. */
export function canPreviewKind(kind: AttachmentKind) {
  return ["image", "video", "pdf", "docx", "text"].includes(kind);
}

export function textFormat(fileName: string, fileType = ""): TextFormat {
  const extension = fileExtension(fileName);
  if (extension === ".csv" || fileType === "text/csv") return "csv";
  if (extension === ".json" || fileType === "application/json") return "json";
  return "plain";
}

/** Short badge text such as "PDF" or "DOCX". */
export function extensionLabel(fileName: string) {
  return fileExtension(fileName).slice(1).toUpperCase() || "FILE";
}

export function attachmentTypeLabel(kind: AttachmentKind, fileName: string) {
  const extension = extensionLabel(fileName);
  switch (kind) {
    case "image":
      return `${extension === "JPEG" ? "JPG" : extension} image`;
    case "video":
      return `${extension === "M4V" ? "MP4" : extension} video`;
    case "pdf":
      return "PDF document";
    case "docx":
    case "word":
      return "Word document";
    case "spreadsheet":
      return "Excel spreadsheet";
    case "presentation":
      return "PowerPoint presentation";
    case "text":
      return extension === "CSV" ? "CSV table" : extension === "JSON" ? "JSON file" : "Text file";
    case "archive":
      return "ZIP archive";
    default:
      return extension === "FILE" ? "File" : `${extension} file`;
  }
}

export function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

/** 7 -> "0:07", 62 -> "1:02", 3723 -> "1:02:03". */
export function formatDuration(totalSeconds: number) {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "";
  const rounded = Math.round(totalSeconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const seconds = rounded % 60;
  const paddedSeconds = String(seconds).padStart(2, "0");
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${paddedSeconds}`;
  return `${minutes}:${paddedSeconds}`;
}

export type MediaTileLayout = {
  /** Columns spanned in a 6-column grid. */
  colSpan: 2 | 3 | 6;
  aspect: "wide" | "landscape" | "square";
};

/**
 * Layout for a message's photos and videos, chat-app style: one item gets the
 * full width, two sit side by side, three put the first on top, four make a
 * 2x2 grid, five use a row of two over a row of three.
 */
export function mediaGridLayout(count: number): MediaTileLayout[] {
  const half: MediaTileLayout = { colSpan: 3, aspect: "landscape" };
  const third: MediaTileLayout = { colSpan: 2, aspect: "square" };
  const full: MediaTileLayout = { colSpan: 6, aspect: "wide" };

  if (count <= 0) return [];
  if (count === 1) return [full];
  if (count === 3) return [full, half, half];
  if (count % 2 === 0) return Array.from({ length: count }, () => half);

  // Odd counts above three: a row of two, then rows of three.
  return [half, half, ...Array.from({ length: count - 2 }, () => third)];
}

export function attachmentUrls(projectId: string, attachmentId: string) {
  const base = `/api/projects/${encodeURIComponent(projectId)}/attachments/${encodeURIComponent(attachmentId)}`;
  return {
    view: `${base}/download`,
    download: `${base}/download?download=1`,
    preview: `${base}/preview`,
  };
}

/**
 * Minimal CSV parser for previews: handles quoted fields, escaped quotes and
 * CRLF line endings. Stops after maxRows rows.
 */
export function parseCsv(text: string, maxRows = 500) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      if (rows.length >= maxRows) return rows;
    } else {
      field += char;
    }
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.slice(0, maxRows);
}
