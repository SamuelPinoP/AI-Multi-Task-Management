// Sign-in history and the last-active date, shown on the owner-only Users page.
// Kept free of server-only imports so it can be unit tested with plain Node.

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** How long each sign-in is kept before the daily cleanup deletes it. */
export const SIGN_IN_HISTORY_DAYS = 365;

/**
 * How stale `User.lastActiveAt` may get. Requests that already read the session refresh it once it's
 * this old, so a busy user costs at most one write an hour, in a request that's awake anyway.
 */
export const LAST_ACTIVE_PRECISION_MS = HOUR_MS;

/** The cleanup deletes sign-ins older than this. */
export function signInHistoryCutoff(now: Date) {
  return new Date(now.getTime() - SIGN_IN_HISTORY_DAYS * DAY_MS);
}

/** Whether a request at `now` should record that the user was active. */
export function isLastActiveStale(lastActiveAt: Date | null | undefined, now: Date) {
  return !lastActiveAt || now.getTime() - lastActiveAt.getTime() >= LAST_ACTIVE_PRECISION_MS;
}

/** Sign-ins recorded before this moment make `lastActiveAt` stale. */
export function lastActiveStaleBefore(now: Date) {
  return new Date(now.getTime() - LAST_ACTIVE_PRECISION_MS);
}

const MAX_USER_AGENT_LENGTH = 512;

// Order matters: Edge and Opera also say "Chrome", and Chrome also says "Safari".
const BROWSERS: Array<[pattern: RegExp, name: string]> = [
  [/\bEdg(e|A|iOS)?\//, "Edge"],
  [/\b(OPR|Opera)\//, "Opera"],
  [/\bSamsungBrowser\//, "Samsung Internet"],
  [/\b(Firefox|FxiOS)\//, "Firefox"],
  [/\b(HeadlessChrome|Chrome|CriOS|Chromium)\//, "Chrome"],
  [/\bVersion\/[\d.]+.*\bSafari\//, "Safari"],
];

// iPhone and iPad before macOS ("like Mac OS X"), and Android before Linux.
const SYSTEMS: Array<[pattern: RegExp, name: string]> = [
  [/\biPhone\b/, "iPhone"],
  [/\biPad\b/, "iPad"],
  [/\bAndroid\b/, "Android"],
  [/\bWindows\b/, "Windows"],
  [/\bCrOS\b/, "ChromeOS"],
  [/\bMac OS X\b|\bMacintosh\b/, "macOS"],
  [/\bLinux\b/, "Linux"],
];

/**
 * The browser and system from a User-Agent header, such as "Chrome on Windows" or "Safari on iPhone".
 * Only these names are kept, never the header itself. Null when neither can be told.
 */
export function describeDevice(userAgent: string | null | undefined) {
  const text = (userAgent ?? "").slice(0, MAX_USER_AGENT_LENGTH);
  if (!text.trim()) return null;
  const browser = BROWSERS.find(([pattern]) => pattern.test(text))?.[1];
  const system = SYSTEMS.find(([pattern]) => pattern.test(text))?.[1];
  if (browser && system) return `${browser} on ${system}`;
  return browser ?? system ?? null;
}

/**
 * The country from Vercel's x-vercel-ip-country header: two capital letters, or null. Local servers
 * and other hosts don't send it.
 */
export function countryFromHeader(value: string | null | undefined) {
  const code = value?.trim().toUpperCase();
  return code && /^[A-Z]{2}$/.test(code) ? code : null;
}

/** A two-letter country code as its English name ("US" is "United States"); the code itself if unknown. */
export function countryName(code: string) {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}
