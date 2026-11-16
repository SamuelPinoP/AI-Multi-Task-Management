// Vercel Web Analytics (#428): what a page view may send. Kept free of browser-only imports, so it can be
// unit tested with plain Node.

/** Path segments this long that contain a digit are ids or tokens, never the name of a page. */
const LONG_SEGMENT = /^[A-Za-z0-9_-]{16,}$/;

/** Whether a path segment is an id or a token: a project's or task's id, or a secret in a link. */
export function isIdSegment(segment: string) {
  return LONG_SEGMENT.test(segment) && /\d/.test(segment);
}

/**
 * The address Web Analytics records for a page view: without the query string or fragment (password
 * reset, email confirmation and invitation links carry their secrets there), and with ids in the path
 * replaced by ":id", so every project's page counts as the same page and no id leaves the app.
 * Absolute addresses keep their origin; anything unreadable becomes "/".
 */
export function scrubAnalyticsUrl(url: string) {
  let parsed: URL;
  try {
    parsed = new URL(url, "https://placeholder.invalid");
  } catch {
    return "/";
  }
  const path = parsed.pathname
    .split("/")
    .map((segment) => (isIdSegment(segment) ? ":id" : segment))
    .join("/");
  return /^[a-z][a-z\d+.-]*:\/\//i.test(url) ? `${parsed.origin}${path}` : path;
}
