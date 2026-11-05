// How long a login lasts (#354). Like GitHub, Google and Slack, an account in
// use stays signed in: a session ends SESSION_IDLE_DAYS after it was last used,
// and SESSION_MAX_DAYS after logging in at the latest (OWASP's idle and absolute
// timeouts). Logging out and resetting the password end sessions sooner.
// Kept free of server-only imports so it can be unit tested with plain Node.

const DAY_MS = 24 * 60 * 60 * 1000;

/** Days without using the app before a session ends. */
export const SESSION_IDLE_DAYS = 30;
/** Days after logging in when a session ends, however much it's used. */
export const SESSION_MAX_DAYS = 365;

/** The latest a session that started at `createdAt` can end. */
export function sessionLimit(createdAt: Date) {
  return new Date(createdAt.getTime() + SESSION_MAX_DAYS * DAY_MS);
}

/** When a session that started at `createdAt` ends if it isn't used again after `now`. */
export function sessionEndsAt(createdAt: Date, now: Date) {
  return new Date(Math.min(now.getTime() + SESSION_IDLE_DAYS * DAY_MS, sessionLimit(createdAt).getTime()));
}

/**
 * The new end of a session used at `now`, or null while the stored end is less
 * than a day behind. So a session in use costs at most one database write a
 * day, made inside a request that already reads the session: nothing extra
 * wakes the database.
 */
export function renewedSessionEnd(session: { createdAt: Date; expiresAt: Date }, now: Date) {
  const end = sessionEndsAt(session.createdAt, now);
  return end.getTime() - session.expiresAt.getTime() >= DAY_MS ? end : null;
}
