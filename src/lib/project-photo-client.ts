// Project photos in the browser (#403): crop and shrink a picked image, then
// save or remove it. The server checks everything again (src/lib/project-photo.ts).
import { PROJECT_PHOTO_MAX_INPUT_BYTES, PROJECT_PHOTO_SIZE, squareCrop } from "@/lib/project-photo";

/** What happens to a project's photo when its sheet is saved; `preview` is the picked photo as a data URL. */
export type ProjectPhotoChange = { kind: "keep" } | { kind: "set"; blob: Blob; preview: string } | { kind: "remove" };

export const KEEP_PROJECT_PHOTO: ProjectPhotoChange = { kind: "keep" };

const UNREADABLE = "Couldn't read that image. Try a JPG or PNG.";

/** A failure whose message can be shown as it is. */
export class ProjectPhotoError extends Error {}

type DecodedImage = { source: CanvasImageSource; width: number; height: number; close: () => void };

async function decode(file: Blob): Promise<DecodedImage> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      // Some browsers decode more formats through an <img>; try that next.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, close: () => undefined };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function canvasBlob(canvas: HTMLCanvasElement, type: string) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.86));
}

/**
 * Cuts the picked image's centered square and draws it at 256 px, as WebP where
 * the browser can write it and JPEG elsewhere: about 10 to 40 KB to upload.
 */
export async function prepareProjectPhoto(file: File): Promise<Blob> {
  if (file.type && !file.type.startsWith("image/")) throw new ProjectPhotoError("Choose an image file.");
  if (file.size > PROJECT_PHOTO_MAX_INPUT_BYTES) throw new ProjectPhotoError("That image is too large. Choose one under 25 MB.");

  let image: DecodedImage;
  try {
    image = await decode(file);
  } catch {
    throw new ProjectPhotoError(UNREADABLE);
  }
  try {
    const { sx, sy, side } = squareCrop(image.width, image.height);
    if (!side) throw new ProjectPhotoError(UNREADABLE);
    const size = Math.min(PROJECT_PHOTO_SIZE, side);
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) throw new ProjectPhotoError("This browser can't prepare photos. Try another one.");
    // JPEG has no transparency, so transparent parts turn white in every format alike.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, size, size);
    context.imageSmoothingQuality = "high";
    context.drawImage(image.source, sx, sy, side, side, 0, 0, size, size);

    const webp = await canvasBlob(canvas, "image/webp");
    const blob = webp?.type === "image/webp" ? webp : await canvasBlob(canvas, "image/jpeg");
    if (!blob) throw new ProjectPhotoError("This browser can't prepare photos. Try another one.");
    return blob;
  } finally {
    image.close();
  }
}

/** A prepared photo as a data URL, for a preview that needs no clean-up (it's 10 to 40 KB). */
export function photoPreviewUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new ProjectPhotoError(UNREADABLE));
    reader.readAsDataURL(blob);
  });
}

async function errorFrom(response: Response, fallback: string) {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return new ProjectPhotoError(body?.error ?? fallback);
}

/** Saves a prepared photo for a project and returns its new version. */
export async function uploadProjectPhoto(projectId: string, blob: Blob): Promise<string> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/photo`, {
    method: "PUT",
    headers: { "Content-Type": blob.type || "application/octet-stream" },
    body: blob,
  }).catch(() => null);
  if (!response) throw new ProjectPhotoError("Couldn't save the photo. Check your connection and try again.");
  if (!response.ok) throw await errorFrom(response, "Couldn't save the photo. Try again.");
  return ((await response.json()) as { photoUpdatedAt: string }).photoUpdatedAt;
}

/** Removes a project's photo; its letter tile shows again. */
export async function removeProjectPhoto(projectId: string): Promise<void> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/photo`, { method: "DELETE" }).catch(() => null);
  if (!response) throw new ProjectPhotoError("Couldn't remove the photo. Check your connection and try again.");
  if (!response.ok) throw await errorFrom(response, "Couldn't remove the photo. Try again.");
}

/** Applies a sheet's photo change once the project is saved. Returns a message to show, or null. */
export async function applyProjectPhotoChange(projectId: string, change: ProjectPhotoChange): Promise<string | null> {
  try {
    if (change.kind === "set") await uploadProjectPhoto(projectId, change.blob);
    else if (change.kind === "remove") await removeProjectPhoto(projectId);
    return null;
  } catch (error) {
    return error instanceof ProjectPhotoError ? error.message : "Couldn't save the photo. Try again.";
  }
}
