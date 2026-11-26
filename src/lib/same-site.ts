// Kept free of server-only imports so it can be unit tested with plain Node.

/**
 * Whether a request comes from this site's own pages. Browsers say so in Sec-Fetch-Site; older ones
 * send an Origin, which must be this host. Forms whose answer acts on the session use it, so another
 * site can't submit them for a signed-in visitor.
 */
export function fromThisSite(request: { headers: { get(name: string): string | null } }) {
  const site = request.headers.get("sec-fetch-site");
  if (site) return site === "same-origin";
  const origin = request.headers.get("origin");
  try {
    return Boolean(origin) && new URL(origin!).host === request.headers.get("host");
  } catch {
    return false;
  }
}
