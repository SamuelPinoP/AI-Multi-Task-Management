export type ByteRange = { start: number; end: number };

/**
 * Parses a single-range `Range: bytes=...` header against a body of `size`
 * bytes. Returns null when the whole body should be sent (no header, an
 * unsupported unit or several ranges) and "unsatisfiable" for a 416.
 */
export function parseByteRange(header: string | null, size: number): ByteRange | "unsatisfiable" | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;

  const [, rawStart, rawEnd] = match;
  if (rawStart === "" && rawEnd === "") return null;
  if (size <= 0) return "unsatisfiable";

  if (rawStart === "") {
    // Suffix range: the last N bytes.
    const length = Number(rawEnd);
    if (length <= 0) return "unsatisfiable";
    return { start: Math.max(0, size - length), end: size - 1 };
  }

  const start = Number(rawStart);
  const end = rawEnd === "" ? size - 1 : Math.min(Number(rawEnd), size - 1);
  if (start >= size || end < start) return "unsatisfiable";
  return { start, end };
}
