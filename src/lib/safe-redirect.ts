// Kept free of server-only imports so it can be unit tested with plain Node.

const PLACEHOLDER_ORIGIN = "http://local.invalid";

// The URL parser drops tabs and newlines and reads "\" as "/", so "/\t/evil.com"
// or "/\evil.com" would turn into "//evil.com" and leave the site.
const UNSAFE_CHARACTERS = /[\u0000-\u001F\u007F\\]/;

export function getSafeRedirectPath(nextPath: string | null | undefined) {
  if (!nextPath || !nextPath.startsWith("/") || UNSAFE_CHARACTERS.test(nextPath)) return "/";

  let url: URL;
  try {
    url = new URL(nextPath, PLACEHOLDER_ORIGIN);
  } catch {
    return "/";
  }

  if (url.origin !== PLACEHOLDER_ORIGIN) return "/";

  // Dot segments can collapse "/.//evil.com" into "//evil.com", which the
  // caller would read as another host.
  const safePath = `${url.pathname}${url.search}${url.hash}`;
  return safePath.startsWith("//") ? "/" : safePath;
}
