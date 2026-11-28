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
  /**
   * Confirmation emails to one account (#350), the one sent at sign-up included. Each
   * also waits a minute after the last (src/lib/email-confirmation-core.ts).
   */
  confirmationEmailsHour: { name: "confirmation-emails-hour", limit: 5, windowMs: 60 * MINUTE },
  confirmationEmailsDay: { name: "confirmation-emails-day", limit: 10, windowMs: 24 * 60 * MINUTE },
  /** Each guest workspace adds a user row. */
  guestIp: { name: "guest-ip", limit: 10, windowMs: 60 * MINUTE },
  invitationsUser: { name: "invitations-user", limit: 30, windowMs: 60 * MINUTE },
  uploadPlansUser: { name: "upload-plans-user", limit: 60, windowMs: 10 * MINUTE },
  /** Direct messages (#387) per sender: a lively chat fits, a script spamming teammates doesn't. */
  directMessagesUser: { name: "direct-messages-user", limit: 120, windowMs: 10 * MINUTE },
  /** Looking people up by exact username to add them to a project (#393): enough to find teammates, too few to sweep usernames. */
  peopleLookupUser: { name: "people-lookup-user", limit: 60, windowMs: 10 * MINUTE },
  /** Task comments (#279) per person: plenty for a discussion, not for a script. */
  taskComments: { name: "task-comments-user", limit: 60, windowMs: 10 * MINUTE },
  /** Project photo uploads (#403) per person: enough to try a few photos, too few to fill the database. */
  projectPhotosUser: { name: "project-photos-user", limit: 20, windowMs: 10 * MINUTE },
  /** Send feedback (#430) per person: each one is an email to every admin, so it's kept low. */
  feedbackUser: { name: "feedback-user", limit: 5, windowMs: 60 * MINUTE },
  /**
   * Messages to the AI assistant (#307) per person: a brisk conversation fits. The daily caps
   * bound the model requests; this keeps a script from hammering the planner and the database.
   */
  agentChatUser: { name: "agent-chat-user", limit: 30, windowMs: 10 * MINUTE },
  /**
   * Estimates (#540) per person: the Estimate button, and the automatic ones for new subtasks. The
   * daily caps bound the model requests; this keeps a burst of new subtasks from all asking at once.
   */
  agentEstimateUser: { name: "agent-estimate-user", limit: 30, windowMs: 10 * MINUTE },
  /**
   * Sign-in for AI apps (#477), per network: every request. Popular apps refresh all their users'
   * tokens from their own servers, so this only stops floods.
   */
  oauthIp: { name: "oauth-ip", limit: 300, windowMs: 10 * MINUTE },
  /**
   * Per app: only requests that prove they come from it, a code with its PKCE secret or a valid
   * refresh token, once the device's and account's own limits let them through. A client ID is
   * public, so counting anything else would let anyone use up an app's share and lock out its users.
   */
  oauthClient: { name: "oauth-client", limit: 300, windowMs: 10 * MINUTE },
  /**
   * Refreshes per device (one refresh token), counted before the account's and the app's limits.
   * About one an hour is normal; this stops one stuck in a loop.
   */
  oauthDevice: { name: "oauth-device", limit: 20, windowMs: 10 * MINUTE },
  /**
   * Codes traded and refreshes per account, counted before the app's limit (#562). Every Allow adds a
   * device, so without this one account's devices could still fill an app's share. With it, one
   * account uses at most a tenth, and one stuck device leaves room for the account's others.
   */
  oauthAccountTokens: { name: "oauth-account-tokens", limit: 30, windowMs: 10 * MINUTE },
  /** Allows per account on the consent page: each saves a code that counts against its app. */
  oauthAccount: { name: "oauth-account", limit: 20, windowMs: 60 * MINUTE },
  /** App registrations (RFC 7591) per network: each adds a row. */
  oauthRegisterIp: { name: "oauth-register-ip", limit: 20, windowMs: 60 * MINUTE },
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
