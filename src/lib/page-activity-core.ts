// Kept free of browser globals so it can be unit tested with plain Node.

/** Automatic checks (the open chat's) pause after this long without a click, key press, scroll or touch. */
export const IDLE_AFTER_MS = 10 * 60_000;
/** Activity after this long without any counts as coming back, as after answering something on a phone. */
export const RETURN_AFTER_MS = 30_000;
/** Focus, visibility and the first click often arrive together: one refresh covers them all. */
export const MIN_RETURN_GAP_MS = 10_000;

/**
 * Tracks whether someone is using the page, so data can refresh once when they
 * come back instead of on a timer. Each method takes the time from `now`.
 */
export function createActivityTracker(now: () => number = Date.now) {
  let lastActivityAt = now();
  // The page just loaded its data, so that counts as the latest refresh.
  let lastReturnAt = lastActivityAt;

  function markReturn(at: number) {
    if (at - lastReturnAt < MIN_RETURN_GAP_MS) return false;
    lastReturnAt = at;
    return true;
  }

  return {
    /** A click, key press, scroll or touch. True when it counts as coming back. */
    activity() {
      const at = now();
      const away = at - lastActivityAt >= RETURN_AFTER_MS;
      lastActivityAt = at;
      return away && markReturn(at);
    },
    /** The tab became visible or the window got focus. True unless the page just refreshed. */
    returned() {
      const at = now();
      lastActivityAt = at;
      return markReturn(at);
    },
    isIdle() {
      return now() - lastActivityAt >= IDLE_AFTER_MS;
    },
  };
}
