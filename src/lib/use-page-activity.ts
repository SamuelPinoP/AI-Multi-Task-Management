import { useEffect, useRef } from "react";
import { createActivityTracker } from "@/lib/page-activity-core";

const ACTIVITY_EVENTS = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"] as const;

let tracker: ReturnType<typeof createActivityTracker> | null = null;
const returnListeners = new Set<() => void>();

function startTracking() {
  if (tracker) return;
  const created = createActivityTracker();
  tracker = created;
  const notify = (cameBack: boolean) => {
    if (cameBack) for (const listener of returnListeners) listener();
  };
  for (const type of ACTIVITY_EVENTS) window.addEventListener(type, () => notify(created.activity()), { passive: true });
  window.addEventListener("focus", () => notify(created.returned()));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") notify(created.returned());
  });
}

/** True after ten minutes without a click, key press, scroll or touch: automatic checks wait for the reader. */
export function isPageIdle() {
  return tracker?.isIdle() ?? false;
}

/**
 * Calls `listener` when the reader comes back to the page: the tab shows again,
 * the window gets focus, or they click, type or scroll after half a minute away
 * (say, after accepting an invitation on their phone). Returns the unsubscribe.
 */
export function onPageReturn(listener: () => void) {
  startTracking();
  returnListeners.add(listener);
  return () => {
    returnListeners.delete(listener);
  };
}

/**
 * Refreshes once each time the reader comes back, rather than on a timer, so
 * other devices' changes show up without keeping the free database awake.
 */
export function useRefreshOnReturn(refresh: () => void) {
  const latest = useRef(refresh);
  useEffect(() => {
    latest.current = refresh;
  });
  useEffect(() => onPageReturn(() => latest.current()), []);
}
