import path from "path";

export const STANDARD_FILE_SIZE_LIMIT = 10 * 1024 * 1024;
export const VIDEO_FILE_SIZE_LIMIT = 100 * 1024 * 1024;
export const MAX_FILES_PER_MESSAGE = 5;

const ALLOWED_EXTENSIONS = new Set([
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".txt",
  ".csv", ".json", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".mp4",
  ".mov", ".webm", ".m4v", ".zip",
]);

const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".webm", ".m4v"]);

const CONTENT_TYPES_BY_EXTENSION: Record<string, string> = {
  ".csv": "text/csv",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".json": "application/json",
  ".m4v": "video/x-m4v",
  ".mov": "video/quicktime",
  ".mp4": "video/mp4",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".txt": "text/plain",
  ".webm": "video/webm",
  ".webp": "image/webp",
  ".zip": "application/zip",
};

export function sanitizeAttachmentName(name: string) {
  return (
    path
      .basename(name)
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .replace(/[^\p{L}\p{N}._()\- ]/gu, "-")
      .trim()
      .slice(0, 180) || "attachment"
  );
}

export function isVideoAttachment(file: Pick<File, "name" | "type">) {
  return VIDEO_EXTENSIONS.has(path.extname(file.name).toLowerCase());
}

/** Derive a safe server-trusted content type from the validated extension. */
export function attachmentContentType(file: Pick<File, "name">) {
  return CONTENT_TYPES_BY_EXTENSION[path.extname(file.name).toLowerCase()] ||
    "application/octet-stream";
}

export function attachmentSizeLimit(file: Pick<File, "name" | "type">) {
  return isVideoAttachment(file) ? VIDEO_FILE_SIZE_LIMIT : STANDARD_FILE_SIZE_LIMIT;
}

export type AttachmentValidationError = "invalid-type" | "unsafe-name" | "too-large";

export function validateProjectChatAttachment(
  file: Pick<File, "name" | "type" | "size">,
): AttachmentValidationError | null {
  if (!file.name || file.name !== path.basename(file.name) || /[\u0000-\u001f\u007f]/.test(file.name)) {
    return "unsafe-name";
  }

  const extension = path.extname(file.name).toLowerCase();
  if (!extension || !ALLOWED_EXTENSIONS.has(extension)) return "invalid-type";
  if (file.size > attachmentSizeLimit(file)) return "too-large";
  return null;
}

export function formatAttachmentSize(size: number) {
  return `${size / (1024 * 1024)} MB`;
}
