// Pure parts of the rate limiter (src/lib/rate-limit.ts): the limits, the
// sliding-window estimate and reading the caller's IP. No server-only imports.

export type RateLimitRule = { name: string; limit: number; windowMs: number };

const MINUTE = 60 * 1000;

export const RATE_LIMITS = {
  /** Every login attempt from one network. */
  loginIp: { name: "login-ip", limit: 30, windowMs: 15 * MINUTE },
  /** Failed logins for one account; cleared after a successful login. */
  loginAccount: { name: "login-account", limit: 5, windowMs: 15 * MINUTE },
  signupIp: { name: "signup-ip", limit: 5, windowMs: 60 * MINUTE },
  /** "Forgot password" requests: they send email, so they're kept low. */
  resetRequestIp: { name: "reset-request-ip", limit: 5, windowMs: 60 * MINUTE },
  resetRequestAccount: { name: "reset-request-account", limit: 3, windowMs: 60 * MINUTE },
  resetSubmitIp: { name: "reset-submit-ip", limit: 10, windowMs: 15 * MINUTE },
  /** Each guest workspace adds a user row. */
  guestIp: { name: "guest-ip", limit: 10, windowMs: 60 * MINUTE },
  invitationsUser: { name: "invitations-user", limit: 30, windowMs: 60 * MINUTE },
  uploadPlansUser: { name: "upload-plans-user", limit: 60, windowMs: 10 * MINUTE },
} as const satisfies Record<string, RateLimitRule>;

/** Start of the fixed window that `nowMs` falls in. */
export function windowStartFor(nowMs: number, windowMs: number) {
  return Math.floor(nowMs / windowMs) * windowMs;
}

/**
 * Sliding-window estimate: this window's count plus the previous window's
 * count, weighted by how much of the previous window still overlaps the last
 * `windowMs`. Smooths out the burst a plain fixed window allows at its edges.
 */
export function slidingWindowCount({
  count,
  previousCount,
  windowStartMs,
  nowMs,
  windowMs,
}: {
  count: number;
  previousCount: number;
  windowStartMs: number;
  nowMs: number;
  windowMs: number;
}) {
  const elapsed = Math.min(Math.max(nowMs - windowStartMs, 0), windowMs);
  return count + previousCount * ((windowMs - elapsed) / windowMs);
}

/** Seconds until the current window ends; the estimate only falls after that. */
export function retryAfterSeconds(windowStartMs: number, nowMs: number, windowMs: number) {
  return Math.max(1, Math.ceil((windowStartMs + windowMs - nowMs) / 1000));
}

export function retryAfterMinutes(seconds: number) {
  return Math.max(1, Math.ceil(seconds / 60));
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1", "localhost"]);

/**
 * The caller's IP: the first x-forwarded-for entry, which Vercel overwrites
 * with the real client address. Returns null for loopback and missing values
 * (local development and CI), where per-IP limits are skipped.
 */
export function clientIpFrom(headers: Pick<Headers, "get">) {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || headers.get("x-real-ip")?.trim() || "";
  if (!ip || LOOPBACK.has(ip)) return null;
  return ip;
}

export function tooManyAttemptsMessage(what: string, retrySeconds: number) {
  const minutes = retryAfterMinutes(retrySeconds);
  return `Too many ${what}. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}
