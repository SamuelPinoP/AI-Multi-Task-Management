// Project photos (#403): the limits and checks shared by the browser, which
// crops and shrinks the image, and the server, which stores it. No server-only
// imports, so they're unit tested.

/** The browser draws every photo on a square this many pixels wide: sharp at 2x for the 40 px tiles, and small. */
export const PROJECT_PHOTO_SIZE = 256;

/** The most the server stores. A 256 px WebP or JPEG is about 10 to 40 KB, so this only stops abuse. */
export const PROJECT_PHOTO_MAX_BYTES = 256 * 1024;

/** The most the browser will try to read; bigger files are refused before decoding. */
export const PROJECT_PHOTO_MAX_INPUT_BYTES = 25 * 1024 * 1024;

export const PROJECT_PHOTO_TYPES = ["image/webp", "image/jpeg", "image/png"] as const;
export type ProjectPhotoType = (typeof PROJECT_PHOTO_TYPES)[number];

function startsWith(bytes: Uint8Array, signature: number[], offset = 0) {
  return bytes.length >= offset + signature.length && signature.every((byte, index) => bytes[offset + index] === byte);
}

/**
 * The photo's real type, read from its first bytes, or null for anything else.
 * The server trusts this, never the request's Content-Type or the file name, so
 * an SVG or HTML file can't be stored and served back as an image.
 */
export function sniffProjectPhotoType(bytes: Uint8Array): ProjectPhotoType | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  // RIFF, a 4-byte size, then WEBP.
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  return null;
}

export const PROJECT_PHOTO_TOO_LARGE = "That image is too large. Try a smaller one.";

/** Why the server refuses these bytes as a photo, or null when they're fine. */
export function projectPhotoProblem(bytes: Uint8Array): string | null {
  if (bytes.length === 0) return "Choose an image.";
  if (bytes.length > PROJECT_PHOTO_MAX_BYTES) return PROJECT_PHOTO_TOO_LARGE;
  if (!sniffProjectPhotoType(bytes)) return "Use a PNG, JPEG or WebP image.";
  return null;
}

/**
 * The centered square to cut from a width x height image: the photo fills its
 * tile like CSS `object-fit: cover`, losing the edges of the longer side.
 */
export function squareCrop(width: number, height: number) {
  const side = Math.min(width, height);
  return { sx: Math.floor((width - side) / 2), sy: Math.floor((height - side) / 2), side };
}

/** The photo's address. `v` changes with every new photo, so browsers can cache each one for good. */
export function projectPhotoUrl(projectId: string, updatedAt: string | Date) {
  const version = new Date(updatedAt).getTime();
  return `/api/projects/${encodeURIComponent(projectId)}/photo?v=${version}`;
}
